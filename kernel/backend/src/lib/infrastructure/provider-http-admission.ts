import { unknownToMessage } from "@ryot-app/contract/errors";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Context, Effect, Layer, Schema } from "effect";

import { redisKeys, RedisService } from "./redis";
import { recordHttpAdmissionTicket } from "./runtime-metrics";

const MINIMUM_TTL_MS = 60_000;
const COMMAND_TIMEOUT_MS = 2_000;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));
const SafeTimestamp = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const PositiveSafeInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));
const SafeInterval = PositiveSafeInteger.pipe(
	Schema.check(Schema.isLessThanOrEqualTo(Math.floor(MAX_SAFE_INTEGER / 10))),
);

/** Kernel bounds on pending tickets and on the work one command may do; not manifest fields. */
export const PROVIDER_HTTP_TICKET_LIMITS = {
	scan: 16,
	tenant: 64,
	policy: 1_024,
	systemTenant: 256,
	retryAfterMs: 3_600_000,
} as const;

export const ProviderHttpAdmissionTiming = Schema.Struct({
	ticketLeaseMs: PositiveSafeInteger,
	tombstoneTtlMs: PositiveSafeInteger,
	minimumGrantLeaseMs: PositiveSafeInteger,
});
export type ProviderHttpAdmissionTiming = typeof ProviderHttpAdmissionTiming.Type;

const productionTiming: ProviderHttpAdmissionTiming = {
	ticketLeaseMs: 120_000,
	tombstoneTtlMs: 600_000,
	minimumGrantLeaseMs: 1_000,
};

export const ProviderHttpAdmissionDeclaration = Schema.Struct({
	key: NonEmptyString,
	hash: NonEmptyString,
	intervalMs: SafeInterval,
	requests: PositiveSafeInteger,
});
export type ProviderHttpAdmissionDeclaration = typeof ProviderHttpAdmissionDeclaration.Type;

export const ProviderHttpTicket = Schema.Struct({
	id: NonEmptyString,
	lane: ExecutionLane,
	tenant: NonEmptyString,
	plugin: NonEmptyString,
});
export type ProviderHttpTicket = typeof ProviderHttpTicket.Type;

export const providerHttpTicketId = (identity: {
	readonly hop: number;
	readonly attempt: number;
	readonly executionId: string;
	readonly requestIndex: number;
}) =>
	[identity.executionId, identity.requestIndex, identity.hop, identity.attempt]
		.map((segment) => encodeURIComponent(String(segment)))
		.join(":");

export const ProviderHttpRegistration = Schema.Union([
	Schema.Struct({ status: Schema.Literal("claimed") }),
	Schema.Struct({ status: Schema.Literal("registered") }),
	Schema.Struct({ observedAtMs: SafeTimestamp, status: Schema.Literal("overloaded") }),
]);
export type ProviderHttpRegistration = typeof ProviderHttpRegistration.Type;

export const ProviderHttpPoll = Schema.Union([
	Schema.Struct({ status: Schema.Literal("retry") }),
	Schema.Struct({ status: Schema.Literal("claimed") }),
	Schema.Struct({ status: Schema.Literal("unknown") }),
	Schema.Struct({ waitMs: SafeTimestamp, status: Schema.Literal("wait") }),
	Schema.Struct({ nonce: NonEmptyString, status: Schema.Literal("granted") }),
]);
export type ProviderHttpPoll = typeof ProviderHttpPoll.Type;

export const ProviderHttpClaim = Schema.Union([
	Schema.Struct({ status: Schema.Literal("unknown") }),
	Schema.Struct({ status: Schema.Literal("admitted") }),
	Schema.Struct({ status: Schema.Literal("rejected") }),
]);
export type ProviderHttpClaim = typeof ProviderHttpClaim.Type;

export const ProviderHttpAdmissionBlockResult = Schema.Union([
	Schema.Struct({ status: Schema.Literal("stale") }),
	Schema.Struct({
		observedAtMs: SafeTimestamp,
		blockedUntilMs: SafeTimestamp,
		status: Schema.Literal("blocked"),
	}),
]);
export type ProviderHttpAdmissionBlockResult = typeof ProviderHttpAdmissionBlockResult.Type;

export class ProviderHttpAdmissionUnavailable extends Schema.TaggedError<ProviderHttpAdmissionUnavailable>()(
	"ProviderHttpAdmissionUnavailable",
	{ message: Schema.String },
) {}

export class ProviderHttpAdmissionCorruptState extends Schema.TaggedError<ProviderHttpAdmissionCorruptState>()(
	"ProviderHttpAdmissionCorruptState",
	{ message: Schema.String },
) {}

const ExpiredLane = Schema.Literals(["", ...ExecutionLane.literals]);

const AdmissionResponse = Schema.Union([
	Schema.Tuple([Schema.Literal("retry")]),
	Schema.Tuple([Schema.Literal("stale")]),
	Schema.Tuple([Schema.Literal("claimed")]),
	Schema.Tuple([Schema.Literal("corrupt")]),
	Schema.Tuple([Schema.Literal("unknown")]),
	Schema.Tuple([Schema.Literal("admitted")]),
	Schema.Tuple([Schema.Literal("rejected")]),
	Schema.Tuple([Schema.Literal("cancelled")]),
	Schema.Tuple([Schema.Literal("registered")]),
	Schema.Tuple([Schema.Literal("overloaded"), Schema.String]),
	Schema.Tuple([Schema.Literal("wait"), Schema.String, ExpiredLane]),
	Schema.Tuple([Schema.Literal("blocked"), Schema.String, Schema.String]),
	Schema.Tuple([Schema.Literal("granted"), Schema.String, Schema.String, ExpiredLane]),
]);
type AdmissionResponse = typeof AdmissionResponse.Type;

// Every key is declared and shares the policy's hash tag; argument and state numbers are parsed
// strictly, and corrupt policy structures fail the policy closed without refreshing their TTL.
const admissionScript = `
local MAX_SAFE_INTEGER = 9007199254740991
local POLICY_LIMIT = ${PROVIDER_HTTP_TICKET_LIMITS.policy}
local TENANT_LIMIT = ${PROVIDER_HTTP_TICKET_LIMITS.tenant}
local SYSTEM_TENANT_LIMIT = ${PROVIDER_HTTP_TICKET_LIMITS.systemTenant}
local SCAN_LIMIT = ${PROVIDER_HTTP_TICKET_LIMITS.scan}
local RETRY_AFTER_LIMIT = ${PROVIDER_HTTP_TICKET_LIMITS.retryAfterMs}
local STARVATION_LIMIT = 4
local POLL_SLACK = 250
local ID_LENGTH = 1024
local SEGMENT_LENGTH = 512
local CORRUPT = {}
local LANES = { interactive = KEYS[5], background = KEYS[6] }
local dirty = false

local function corrupt()
  error(CORRUPT)
end

local function parse_non_negative_integer(value)
  if type(value) ~= "string" or not string.match(value, "^%d+$") then
    return nil
  end
  local parsed = tonumber(value)
  if not parsed or parsed < 0 or parsed > MAX_SAFE_INTEGER or parsed % 1 ~= 0 then
    return nil
  end
  return parsed
end

local function parse_positive_integer(value)
  local parsed = parse_non_negative_integer(value)
  if not parsed or parsed == 0 then
    return nil
  end
  return parsed
end

local function format_integer(value)
  return string.format("%.0f", value)
end

local function valid_segment(value, length)
  return type(value) == "string" and #value > 0 and #value <= length
    and string.match(value, "^[%w%-_%.!~%*'%(%):%%]+$") ~= nil
end

local function read(...)
  local reply = redis.pcall(...)
  if type(reply) == "table" and reply.err then
    corrupt()
  end
  return reply
end

local function write(...)
  dirty = true
  return redis.call(...)
end

local time = redis.call("TIME")
local seconds = parse_non_negative_integer(time[1])
local microseconds = parse_non_negative_integer(time[2])
if not seconds or not microseconds or microseconds >= 1000000 then
  return { "corrupt" }
end
local now = seconds * 1000 + math.floor(microseconds / 1000)

local operation = ARGV[1]
local declaration_hash = ARGV[2]
local spacing = parse_positive_integer(ARGV[3])
local base_ttl = parse_positive_integer(ARGV[4])
local ticket_lease = parse_positive_integer(ARGV[5])
local minimum_grant_lease = parse_positive_integer(ARGV[6])
local tombstone_ttl = parse_positive_integer(ARGV[7])
if not valid_segment(declaration_hash, SEGMENT_LENGTH) or not spacing or not base_ttl
  or not ticket_lease or not minimum_grant_lease or not tombstone_ttl then
  return { "corrupt" }
end
local grant_lease = math.max(spacing, minimum_grant_lease)
local hint_ceiling = math.floor(ticket_lease / 2)
local idle_ttl = math.max(base_ttl, ticket_lease, tombstone_ttl)

local STATE_FIELDS = { h = true, a = true, b = true, g = true, n = true, x = true, s = true, q = true }
local STATE_NUMBERS = { "a", "b", "x", "s", "q" }
local TICKET_NUMBERS = { "w", "d", "r" }

local function load_state()
  local raw = read("HGETALL", KEYS[1])
  if #raw == 0 then
    return nil
  end
  if #raw ~= 16 then
    corrupt()
  end
  local values = {}
  for index = 1, #raw, 2 do
    local field = raw[index]
    if not STATE_FIELDS[field] or values[field] ~= nil then
      corrupt()
    end
    values[field] = raw[index + 1]
  end
  local state = { h = values.h, g = values.g, n = values.n }
  if not valid_segment(state.h, SEGMENT_LENGTH) then
    corrupt()
  end
  for _, field in ipairs(STATE_NUMBERS) do
    state[field] = parse_non_negative_integer(values[field])
    if not state[field] then
      corrupt()
    end
  end
  if state.g == "" then
    if state.n ~= "" or state.x ~= 0 then
      corrupt()
    end
  elseif not valid_segment(state.g, ID_LENGTH) or not valid_segment(state.n, SEGMENT_LENGTH) then
    corrupt()
  end
  return state
end

local function new_state(hash)
  dirty = true
  return { h = hash, a = 0, b = 0, g = "", n = "", x = 0, s = 0, q = 0 }
end

local function clear_grant(state)
  if state.g ~= "" then
    dirty = true
  end
  state.g = ""
  state.n = ""
  state.x = 0
end

local function commit(state)
  if not dirty then
    return
  end
  redis.call(
    "HSET", KEYS[1],
    "h", state.h, "a", format_integer(state.a), "b", format_integer(state.b), "g", state.g,
    "n", state.n, "x", format_integer(state.x), "s", format_integer(state.s), "q", format_integer(state.q)
  )
  local ttl = idle_ttl + math.max(0, state.b - now)
  for index = 1, #KEYS do
    redis.call("PEXPIRE", KEYS[index], ttl)
  end
end

local function load_ticket(id)
  local raw = read("HGET", KEYS[2], id)
  if not raw then
    return nil
  end
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok or type(decoded) ~= "table" then
    return false
  end
  local fields = 0
  for _ in pairs(decoded) do
    fields = fields + 1
  end
  local ticket = { h = decoded.h, l = decoded.l, t = decoded.t, p = decoded.p }
  if fields ~= 7 or not valid_segment(ticket.h, SEGMENT_LENGTH) or not LANES[ticket.l]
    or not valid_segment(ticket.t, SEGMENT_LENGTH) or not valid_segment(ticket.p, SEGMENT_LENGTH) then
    return false
  end
  for _, field in ipairs(TICKET_NUMBERS) do
    ticket[field] = parse_non_negative_integer(decoded[field])
    if not ticket[field] then
      return false
    end
  end
  return ticket
end

local function save_ticket(id, ticket)
  write("HSET", KEYS[2], id, cjson.encode({
    h = ticket.h, l = ticket.l, t = ticket.t, p = ticket.p,
    w = format_integer(ticket.w), d = format_integer(ticket.d), r = format_integer(ticket.r),
  }))
  write("ZADD", KEYS[4], format_integer(ticket.w), id)
end

local function read_array(key, field)
  local raw = read("HGET", key, field)
  if not raw then
    return nil
  end
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok or type(decoded) ~= "table" or #decoded == 0 then
    corrupt()
  end
  local entries = 0
  for index, value in pairs(decoded) do
    entries = entries + 1
    if type(index) ~= "number" or not valid_segment(value, ID_LENGTH) then
      corrupt()
    end
  end
  if entries ~= #decoded then
    corrupt()
  end
  return decoded
end

local function write_array(key, field, values)
  if #values == 0 then
    write("HDEL", key, field)
  else
    write("HSET", key, field, cjson.encode(values))
  end
end

local function index_of(values, value)
  for index = 1, #values do
    if values[index] == value then
      return index
    end
  end
  return nil
end

local function ring_field(lane, tenant)
  return lane .. "\\n" .. tenant
end

local function flow_field(lane, tenant, plugin)
  return lane .. "\\n" .. tenant .. "\\n" .. plugin
end

local function read_count(field)
  local raw = read("HGET", KEYS[9], field)
  if not raw then
    return 0
  end
  local value = parse_positive_integer(raw)
  if not value then
    corrupt()
  end
  return value
end

local function write_count(field, value)
  if value == 0 then
    write("HDEL", KEYS[9], field)
  else
    write("HSET", KEYS[9], field, format_integer(value))
  end
end

local function lane_count(lane)
  return read_count("l\\n" .. lane)
end

local function tombstoned(id)
  local claimed_at = parse_non_negative_integer(read("ZSCORE", KEYS[3], id))
  return claimed_at ~= nil and claimed_at + tombstone_ttl > now
end

local function ticket_dead(state, ticket)
  return ticket.h ~= state.h or math.max(ticket.w, state.b) + ticket_lease <= now
end

-- A tenant is in its lane ring exactly while it has a plugin ring, and a plugin is in its tenant's
-- ring exactly while its flow holds tickets.
local function enqueue(id, ticket)
  local tenant_ring = ring_field(ticket.l, ticket.t)
  local tenant_flow = flow_field(ticket.l, ticket.t, ticket.p)
  local ring = read_array(KEYS[7], tenant_ring)
  local flow = read_array(KEYS[8], tenant_flow)
  local tenant_total = read_count("t\\n" .. tenant_ring)
  local lane_total = lane_count(ticket.l)
  if flow and (not ring or not index_of(ring, ticket.p)) then
    corrupt()
  end
  if not ring then
    if read("LPOS", LANES[ticket.l], ticket.t) then
      corrupt()
    end
    write("RPUSH", LANES[ticket.l], ticket.t)
    ring = {}
  end
  if not flow then
    ring[#ring + 1] = ticket.p
    write_array(KEYS[7], tenant_ring, ring)
    flow = {}
  end
  flow[#flow + 1] = id
  write_array(KEYS[8], tenant_flow, flow)
  write_count("t\\n" .. tenant_ring, tenant_total + 1)
  write_count("l\\n" .. ticket.l, lane_total + 1)
  save_ticket(id, ticket)
end

-- Rings advance only on an admitted claim (rotate); other removals keep every ring position.
local function remove_entry(state, id, lane, tenant, plugin, rotate)
  local tenant_ring = ring_field(lane, tenant)
  local tenant_flow = flow_field(lane, tenant, plugin)
  local ring = read_array(KEYS[7], tenant_ring)
  local flow = read_array(KEYS[8], tenant_flow)
  if not ring or not flow then
    corrupt()
  end
  local plugin_index = index_of(ring, plugin)
  local flow_index = index_of(flow, id)
  local tenant_total = read_count("t\\n" .. tenant_ring)
  local lane_total = lane_count(lane)
  if not plugin_index or not flow_index or tenant_total == 0 or lane_total == 0 then
    corrupt()
  end
  table.remove(flow, flow_index)
  write_array(KEYS[8], tenant_flow, flow)
  if #flow == 0 or rotate then
    table.remove(ring, plugin_index)
    if #flow > 0 then
      ring[#ring + 1] = plugin
    end
  end
  write_array(KEYS[7], tenant_ring, ring)
  if #ring == 0 or rotate then
    write("LREM", LANES[lane], 0, tenant)
    if #ring > 0 then
      write("RPUSH", LANES[lane], tenant)
    end
  end
  write_count("t\\n" .. tenant_ring, tenant_total - 1)
  write_count("l\\n" .. lane, lane_total - 1)
  write("HDEL", KEYS[2], id)
  write("ZREM", KEYS[4], id)
  if state.g == id then
    clear_grant(state)
  end
end

local function remove_ticket(state, id, ticket, rotate)
  remove_entry(state, id, ticket.l, ticket.t, ticket.p, rotate)
end

-- Without its coordinates a corrupt ticket leaves a dangling flow entry that selection removes.
local function drop_corrupt_ticket(state, id)
  write("HDEL", KEYS[2], id)
  write("ZREM", KEYS[4], id)
  if state.g == id then
    clear_grant(state)
  end
end

local function cleanup(state)
  local expired = read("ZRANGEBYSCORE", KEYS[3], "-inf", format_integer(now - tombstone_ttl), "LIMIT", 0, SCAN_LIMIT)
  for _, id in ipairs(expired) do
    write("ZREM", KEYS[3], id)
  end
  if state.b + ticket_lease > now then
    return 0
  end
  local removed = 0
  local candidates = read("ZRANGEBYSCORE", KEYS[4], "-inf", format_integer(now - ticket_lease), "LIMIT", 0, SCAN_LIMIT)
  for _, id in ipairs(candidates) do
    local ticket = load_ticket(id)
    if ticket == nil then
      write("ZREM", KEYS[4], id)
    elseif ticket == false then
      drop_corrupt_ticket(state, id)
    elseif ticket_dead(state, ticket) then
      remove_ticket(state, id, ticket, false)
    end
    removed = removed + 1
  end
  return removed
end

local function lane_order(state)
  if state.s >= STARVATION_LIMIT and lane_count("background") > 0 then
    return { "background", "interactive" }
  end
  return { "interactive", "background" }
end

local function scan_flow(state, caller, lane, tenant, plugin, dead, budget)
  local flow = read_array(KEYS[8], flow_field(lane, tenant, plugin))
  if not flow then
    corrupt()
  end
  for index = 1, math.min(#flow, SCAN_LIMIT) do
    local id = flow[index]
    local ticket = load_ticket(id)
    if ticket and (ticket.l ~= lane or ticket.t ~= tenant or ticket.p ~= plugin) then
      corrupt()
    end
    if not ticket or ticket_dead(state, ticket) then
      dead[#dead + 1] = { id = id, lane = lane, tenant = tenant, plugin = plugin }
      if #dead >= budget then
        return nil, true
      end
    elseif id == caller or ticket.d <= now + grant_lease then
      return id, false
    end
  end
  return nil, false
end

-- First eligible ticket by lane, tenant ring, plugin ring and flow order, visiting at most
-- SCAN_LIMIT flows; skipped tenants and plugins keep their ring positions.
local function select_ticket(state, caller, budget)
  local dead = {}
  local visited = 0
  for _, lane in ipairs(lane_order(state)) do
    local tenants = read("LRANGE", LANES[lane], 0, SCAN_LIMIT - 1)
    for _, tenant in ipairs(tenants) do
      local ring = read_array(KEYS[7], ring_field(lane, tenant))
      if not ring then
        corrupt()
      end
      for _, plugin in ipairs(ring) do
        if visited >= SCAN_LIMIT then
          return nil, dead, false
        end
        visited = visited + 1
        local id, exhausted = scan_flow(state, caller, lane, tenant, plugin, dead, budget)
        if id or exhausted then
          return id, dead, exhausted
        end
      end
    end
  end
  return nil, dead, false
end

local function open_slot(state)
  local spaced = 0
  if state.a > 0 then
    spaced = state.a + spacing
  end
  return math.max(spaced, state.b)
end

-- Estimated turn: an outstanding grant, the higher lane's share, tenants ahead in this lane ring
-- and full rounds for the ticket's place among its tenant's plugins and its flow depth.
local function wake_hint(state, id, ticket)
  local tenant_index = read("LPOS", LANES[ticket.l], ticket.t)
  local tenants = read("LLEN", LANES[ticket.l])
  local ring = read_array(KEYS[7], ring_field(ticket.l, ticket.t))
  local flow = read_array(KEYS[8], flow_field(ticket.l, ticket.t, ticket.p))
  if not tenant_index or not ring or not flow then
    corrupt()
  end
  local plugin_index = index_of(ring, ticket.p)
  local depth = index_of(flow, id)
  if not plugin_index or not depth then
    corrupt()
  end
  local position = tenant_index + ((depth - 1) * #ring + plugin_index - 1) * tenants
  if state.g ~= "" then
    position = position + 1
  end
  if ticket.l == "background" then
    position = position + math.min(lane_count("interactive"), STARVATION_LIMIT)
  end
  local estimate = math.max(open_slot(state), now) - now + spacing * position
  local floor_hint = math.min(spacing, hint_ceiling)
  local ceiling = hint_ceiling + math.max(0, state.b - now)
  return math.floor(math.min(math.max(estimate, floor_hint), ceiling))
end

local function register(id, lane, tenant, plugin)
  local state = load_state()
  if not state then
    state = new_state(declaration_hash)
  elseif state.h ~= declaration_hash then
    state.h = declaration_hash
    dirty = true
    clear_grant(state)
  end
  if tombstoned(id) then
    commit(state)
    return { "claimed" }
  end
  cleanup(state)
  local existing = load_ticket(id)
  if existing == false then
    return { "corrupt" }
  end
  if existing then
    if ticket_dead(state, existing) then
      remove_ticket(state, id, existing, false)
    elseif existing.l == lane and existing.t == tenant and existing.p == plugin then
      commit(state)
      return { "registered" }
    else
      return { "corrupt" }
    end
  end
  local tenant_limit = TENANT_LIMIT
  if tenant == "system" then
    tenant_limit = SYSTEM_TENANT_LIMIT
  end
  if read("HLEN", KEYS[2]) >= POLICY_LIMIT or read_count("t\\n" .. ring_field(lane, tenant)) >= tenant_limit then
    commit(state)
    return { "overloaded", format_integer(now) }
  end
  enqueue(id, { h = declaration_hash, l = lane, t = tenant, p = plugin, w = now, d = now, r = now })
  commit(state)
  return { "registered" }
end

local function poll(id)
  local state = load_state()
  if not state then
    return { "unknown" }
  end
  if tombstoned(id) then
    return { "claimed" }
  end
  local ticket = load_ticket(id)
  if ticket == false then
    return { "corrupt" }
  end
  if state.h ~= declaration_hash then
    if ticket then
      remove_ticket(state, id, ticket, false)
    end
    commit(state)
    return { "unknown" }
  end
  local removed = cleanup(state)
  ticket = load_ticket(id)
  if not ticket or ticket_dead(state, ticket) then
    if ticket then
      remove_ticket(state, id, ticket, false)
    end
    commit(state)
    return { "unknown" }
  end
  ticket.w = now
  local expired_lane = ""
  if state.g ~= "" and state.x <= now then
    if state.g == id then
      expired_lane = ticket.l
    else
      local grantee = load_ticket(state.g)
      if grantee then
        grantee.d = MAX_SAFE_INTEGER
        save_ticket(state.g, grantee)
        expired_lane = grantee.l
      end
    end
    clear_grant(state)
  end
  local open = now >= open_slot(state)
  if state.g == id then
    if open then
      save_ticket(id, ticket)
      commit(state)
      return { "granted", state.n, format_integer(now - ticket.r), expired_lane }
    end
    clear_grant(state)
  end
  if open and state.g == "" then
    local selected, dead, exhausted = select_ticket(state, id, SCAN_LIMIT - removed)
    for _, entry in ipairs(dead) do
      remove_entry(state, entry.id, entry.lane, entry.tenant, entry.plugin, false)
    end
    if exhausted then
      save_ticket(id, ticket)
      commit(state)
      return { "retry" }
    end
    state.q = state.q + 1
    state.g = selected or id
    state.n = format_integer(now) .. "-" .. format_integer(state.q)
    state.x = now + grant_lease
    dirty = true
    if state.g == id then
      save_ticket(id, ticket)
      commit(state)
      return { "granted", state.n, format_integer(now - ticket.r), expired_lane }
    end
  end
  local hint = wake_hint(state, id, ticket)
  ticket.d = now + hint + POLL_SLACK
  save_ticket(id, ticket)
  commit(state)
  return { "wait", format_integer(hint), expired_lane }
end

local function claim(id, nonce)
  if tombstoned(id) then
    return { "admitted" }
  end
  local state = load_state()
  if not state then
    return { "unknown" }
  end
  local ticket = load_ticket(id)
  if ticket == false then
    return { "corrupt" }
  end
  if not ticket or state.h ~= declaration_hash or ticket_dead(state, ticket) then
    if ticket then
      remove_ticket(state, id, ticket, false)
    end
    commit(state)
    return { "unknown" }
  end
  if state.g ~= id or state.n ~= nonce or state.x <= now then
    return { "rejected" }
  end
  if now < open_slot(state) then
    clear_grant(state)
    commit(state)
    return { "rejected" }
  end
  if ticket.l == "background" then
    state.s = 0
  elseif lane_count("background") > 0 then
    state.s = state.s + 1
  end
  state.a = now
  clear_grant(state)
  remove_ticket(state, id, ticket, true)
  write("ZADD", KEYS[3], format_integer(now), id)
  commit(state)
  return { "admitted" }
end

local function cancel(id)
  local state = load_state()
  if not state then
    return { "cancelled" }
  end
  local ticket = load_ticket(id)
  if ticket == false then
    drop_corrupt_ticket(state, id)
  elseif ticket then
    remove_ticket(state, id, ticket, false)
  end
  commit(state)
  return { "cancelled" }
end

local function block(delay)
  local state = load_state()
  if state and state.h ~= declaration_hash then
    return { "stale" }
  end
  if not state then
    state = new_state(declaration_hash)
  end
  state.b = math.max(state.b, now + delay)
  dirty = true
  commit(state)
  return { "blocked", format_integer(state.b), format_integer(now) }
end

local function main()
  if operation == "block" then
    local delay = parse_non_negative_integer(ARGV[8])
    if not delay or delay > RETRY_AFTER_LIMIT then
      return { "corrupt" }
    end
    return block(delay)
  end
  local id = ARGV[8]
  if not valid_segment(id, ID_LENGTH) then
    return { "corrupt" }
  end
  if operation == "register" then
    if not LANES[ARGV[9]] or not valid_segment(ARGV[10], SEGMENT_LENGTH) or not valid_segment(ARGV[11], SEGMENT_LENGTH) then
      return { "corrupt" }
    end
    return register(id, ARGV[9], ARGV[10], ARGV[11])
  end
  if operation == "poll" then
    return poll(id)
  end
  if operation == "claim" then
    if not valid_segment(ARGV[9], SEGMENT_LENGTH) then
      return { "corrupt" }
    end
    return claim(id, ARGV[9])
  end
  if operation == "cancel" then
    return cancel(id)
  end
  return { "corrupt" }
end

local ok, reply = pcall(main)
if ok then
  return reply
end
if reply ~= CORRUPT then
  if type(reply) == "table" and reply.err then
    return redis.error_reply(reply.err)
  end
  return redis.error_reply(tostring(reply))
end
-- Keys created before corruption was detected still get a bound; existing TTLs are not refreshed.
for index = 1, #KEYS do
  if redis.call("PTTL", KEYS[index]) == -1 then
    redis.call("PEXPIRE", KEYS[index], idle_ttl)
  end
end
return { "corrupt" }
`;

const corruptState = (message: string) => new ProviderHttpAdmissionCorruptState({ message });

const parseTimestamp = (value: string, operation: string) => {
	if (!/^\d+$/.test(value)) {
		return Effect.fail(corruptState(`Redis returned an invalid ${operation} timestamp`));
	}
	const timestamp = Number(value);
	return Number.isSafeInteger(timestamp)
		? Effect.succeed(timestamp)
		: Effect.fail(corruptState(`Redis returned an invalid ${operation} timestamp`));
};

const validateDeclaration = (declaration: ProviderHttpAdmissionDeclaration) =>
	declaration.key.length > 0 &&
	declaration.hash.length > 0 &&
	Number.isSafeInteger(declaration.requests) &&
	declaration.requests > 0 &&
	Number.isSafeInteger(declaration.intervalMs) &&
	declaration.intervalMs > 0 &&
	declaration.intervalMs <= Math.floor(MAX_SAFE_INTEGER / 10)
		? Effect.succeed({
				ttlMs: Math.max(10 * declaration.intervalMs, MINIMUM_TTL_MS),
				spacingMs: Math.ceil(declaration.intervalMs / declaration.requests),
			})
		: Effect.fail(corruptState("Provider HTTP admission declaration is invalid"));

const decodeResponse = (value: unknown) =>
	Schema.decodeUnknownEffect(AdmissionResponse)(value).pipe(
		Effect.mapError(() => corruptState("Redis returned an invalid admission response")),
	);

const unexpected = (response: AdmissionResponse, operation: string) =>
	response[0] === "corrupt"
		? corruptState("Redis admission state is corrupt")
		: corruptState(`Redis returned an unexpected ${operation} response`);

const policyKeys = (policyKey: string) => {
	const keys = redisKeys.providerHttpAdmission(policyKey);
	return [
		keys.state,
		keys.tickets,
		keys.tombstones,
		keys.renewals,
		keys.interactiveTenants,
		keys.backgroundTenants,
		keys.plugins,
		keys.flows,
		keys.counts,
	];
};

const segment = (value: string) => encodeURIComponent(value);

const recordExpired = (declaration: ProviderHttpAdmissionDeclaration, lane: string) =>
	lane === "interactive" || lane === "background"
		? recordHttpAdmissionTicket({ lane, outcome: "expired", policy: declaration.key })
		: Effect.void;

export const makeProviderHttpAdmission = Effect.fnUntraced(function* (
	timing: ProviderHttpAdmissionTiming,
) {
	const redis = yield* RedisService;

	const execute = (
		declaration: ProviderHttpAdmissionDeclaration,
		operation: string,
		values: ReadonlyArray<string>,
	) =>
		Effect.gen(function* () {
			const { ttlMs, spacingMs } = yield* validateDeclaration(declaration);
			const keys = policyKeys(declaration.key);
			const response = yield* Effect.tryPromise({
				catch: (error) =>
					new ProviderHttpAdmissionUnavailable({
						message: `Redis admission command failed: ${unknownToMessage(error)}`,
					}),
				try: () =>
					redis.client.eval(
						admissionScript,
						keys.length,
						...keys,
						operation,
						declaration.hash,
						String(spacingMs),
						String(ttlMs),
						String(timing.ticketLeaseMs),
						String(timing.minimumGrantLeaseMs),
						String(timing.tombstoneTtlMs),
						...values,
					),
			}).pipe(
				Effect.timeoutOrElse({
					duration: COMMAND_TIMEOUT_MS,
					orElse: () =>
						Effect.fail(
							new ProviderHttpAdmissionUnavailable({
								message: "Redis admission command timed out",
							}),
						),
				}),
			);
			return yield* decodeResponse(response);
		});

	const register = Effect.fn("ProviderHttpAdmissionService.register")(function* (
		declaration: ProviderHttpAdmissionDeclaration,
		ticket: ProviderHttpTicket,
	) {
		const response = yield* execute(declaration, "register", [
			ticket.id,
			ticket.lane,
			segment(ticket.tenant),
			segment(ticket.plugin),
		]);
		if (response[0] === "registered" || response[0] === "claimed") {
			return { status: response[0] } satisfies ProviderHttpRegistration;
		}
		if (response[0] !== "overloaded") {
			return yield* unexpected(response, "registration");
		}
		yield* recordHttpAdmissionTicket({
			lane: ticket.lane,
			outcome: "overloaded",
			policy: declaration.key,
		});
		return {
			status: "overloaded",
			observedAtMs: yield* parseTimestamp(response[1], "observation"),
		} satisfies ProviderHttpRegistration;
	});

	const poll = Effect.fn("ProviderHttpAdmissionService.poll")(function* (
		declaration: ProviderHttpAdmissionDeclaration,
		ticket: ProviderHttpTicket,
	) {
		const response = yield* execute(declaration, "poll", [ticket.id]);
		if (response[0] === "retry" || response[0] === "claimed" || response[0] === "unknown") {
			return { status: response[0] } satisfies ProviderHttpPoll;
		}
		if (response[0] === "wait") {
			const waitMs = yield* parseTimestamp(response[1], "wake hint");
			yield* recordExpired(declaration, response[2]);
			return { waitMs, status: "wait" } satisfies ProviderHttpPoll;
		}
		if (response[0] !== "granted") {
			return yield* unexpected(response, "poll");
		}
		const waitedMs = yield* parseTimestamp(response[2], "ticket wait");
		if (response[1].length === 0) {
			return yield* corruptState("Redis returned an empty grant nonce");
		}
		yield* recordExpired(declaration, response[3]);
		yield* recordHttpAdmissionTicket({
			waitedMs,
			lane: ticket.lane,
			outcome: "granted",
			policy: declaration.key,
		});
		return { status: "granted", nonce: response[1] } satisfies ProviderHttpPoll;
	});

	const claim = Effect.fn("ProviderHttpAdmissionService.claim")(function* (
		declaration: ProviderHttpAdmissionDeclaration,
		ticket: ProviderHttpTicket,
		nonce: string,
	) {
		const response = yield* execute(declaration, "claim", [ticket.id, nonce]);
		if (response[0] === "admitted" || response[0] === "rejected" || response[0] === "unknown") {
			return { status: response[0] } satisfies ProviderHttpClaim;
		}
		return yield* unexpected(response, "claim");
	});

	const cancel = Effect.fn("ProviderHttpAdmissionService.cancel")(function* (
		declaration: ProviderHttpAdmissionDeclaration,
		ticket: ProviderHttpTicket,
	) {
		const response = yield* execute(declaration, "cancel", [ticket.id]);
		return response[0] === "cancelled" ? undefined : yield* unexpected(response, "cancel");
	});

	const block = Effect.fn("ProviderHttpAdmissionService.block")(function* (
		declaration: ProviderHttpAdmissionDeclaration,
		delayMs: number,
	) {
		if (
			!Number.isSafeInteger(delayMs) ||
			delayMs < 0 ||
			delayMs > PROVIDER_HTTP_TICKET_LIMITS.retryAfterMs
		) {
			return yield* corruptState("Provider HTTP admission block delay is invalid");
		}
		const response = yield* execute(declaration, "block", [String(delayMs)]);
		if (response[0] === "stale") {
			return { status: "stale" } satisfies ProviderHttpAdmissionBlockResult;
		}
		if (response[0] !== "blocked") {
			return yield* unexpected(response, "block");
		}
		return {
			status: "blocked",
			blockedUntilMs: yield* parseTimestamp(response[1], "block"),
			observedAtMs: yield* parseTimestamp(response[2], "observation"),
		} satisfies ProviderHttpAdmissionBlockResult;
	});

	return { poll, block, claim, cancel, register };
});

export class ProviderHttpAdmissionService extends Context.Service<ProviderHttpAdmissionService>()(
	"ProviderHttpAdmissionService",
	{ make: makeProviderHttpAdmission(productionTiming) },
) {
	static readonly layer = Layer.effect(this, this.make);
}

import csv, sys, re, os, collections, json
csv.field_size_limit(10**9)
root = sys.argv[1]; commits = sys.argv[2:]
def norm(q):
    q = re.sub(r'\s+', ' ', q)
    q = re.sub(r'\$\d+', '$', q)
    q = re.sub(r'(\$, )+\$', '$..', q)
    return q
def load_pgss(c):
    p = os.path.join(root, f"{c}", 'pgss.csv'); agg = collections.defaultdict(lambda: [0, 0.0, 0])
    if not os.path.exists(p): return agg
    for r in csv.DictReader(open(p)):
        if r['datname'] != 'test_db': continue
        k = norm(r['query']); a = agg[k]; a[0] += int(r['calls']); a[1] += float(r['total_exec_time']); a[2] += int(r['rows'])
    return agg
def load_spans(c):
    p = os.path.join(root, f"{c}", 'metrics.prom'); calls = {}; dur = {}
    if not os.path.exists(p): return calls, dur
    for line in open(p):
        m = re.match(r'(traces_span_metrics_calls_total|traces_span_metrics_duration_milliseconds_sum)\{(.*)\} ([0-9.e+]+)', line)
        if not m: continue
        name = re.search(r'span_name="((?:[^"\\]|\\.)*)"', m.group(2)).group(1)
        v = float(m.group(3))
        d = calls if m.group(1).endswith('calls_total') else dur
        d[name] = d.get(name, 0) + v
    return calls, dur
def load_buckets(c):
    p = os.path.join(root, f"{c}", 'metrics.prom'); buckets = collections.defaultdict(dict)
    if not os.path.exists(p): return buckets
    for line in open(p):
        m = re.match(r'traces_span_metrics_duration_milliseconds_bucket\{(.*)\} ([0-9.e+]+)', line)
        if not m: continue
        name = re.search(r'span_name="((?:[^"\\]|\\.)*)"', m.group(1)).group(1)
        le = re.search(r'le="([^"]*)"', m.group(1)).group(1)
        buckets[name][le] = buckets[name].get(le, 0) + float(m.group(2))
    return buckets
mode = os.environ.get('MODE', 'summary')
pg = {c: load_pgss(c) for c in commits}; sp = {c: load_spans(c) for c in commits}; bk = {c: load_buckets(c) for c in commits}
for c in commits:
    st = open(os.path.join(root, f"{c}", 'status.txt')).read().strip() if os.path.exists(os.path.join(root, f"{c}", 'status.txt')) else '?'
    print(f"{c}: {st} queries={sum(v[0] for v in pg[c].values()):,} db_ms={sum(v[1] for v in pg[c].values()):,.0f} rows={sum(v[2] for v in pg[c].values()):,} shapes={len(pg[c])} spans={sum(sp[c][0].values()):,.0f}")
if mode == 'pgdiff':
    a, b = commits[0], commits[-1]
    keys = set(pg[a]) | set(pg[b])
    rows = []
    for k in keys:
        x = pg[a].get(k, [0, 0.0, 0]); y = pg[b].get(k, [0, 0.0, 0])
        rows.append((y[1] - x[1], x, y, k))
    rows.sort(key=lambda r: -r[0])
    print(f"\nTop by exec-time increase {a} -> {b}")
    print(f"{'d_ms':>9s} {'calls_a':>8s} {'calls_b':>8s} {'ms_a':>8s} {'ms_b':>8s} {'rows_b':>9s}  query")
    for d, x, y, k in rows[:int(os.environ.get('N', '30'))]:
        print(f"{d:9.0f} {x[0]:8d} {y[0]:8d} {x[1]:8.0f} {y[1]:8.0f} {y[2]:9d}  {k[:int(os.environ.get('W','170'))]}")
    rows.sort(key=lambda r: -(r[2][0] - r[1][0]))
    print(f"\nTop by call-count increase {a} -> {b}")
    for d, x, y, k in rows[:int(os.environ.get('N', '30'))]:
        print(f"{y[0]-x[0]:9d} {x[0]:8d} {y[0]:8d} {x[1]:8.0f} {y[1]:8.0f} {y[2]:9d}  {k[:int(os.environ.get('W','170'))]}")
if mode == 'spans':
    cs = commits
    names = set().union(*[set(sp[c][0]) for c in cs])
    key = cs[-1]
    rows = sorted(names, key=lambda n: -sp[key][1].get(n, 0))
    hdr = ' '.join(f"{c[:6]+'_n':>10s} {c[:6]+'_s':>9s}" for c in cs)
    print(f"{hdr}  span")
    flt = os.environ.get('FILTER')
    shown = 0
    for n in rows:
        if flt and not re.search(flt, n): continue
        print(' '.join(f"{sp[c][0].get(n,0):10.0f} {sp[c][1].get(n,0)/1000:9.1f}" for c in cs) + '  ' + n[:110])
        shown += 1
        if shown >= int(os.environ.get('N', '40')): break
if mode == 'targets':
    def pg_sum(c, pred):
        calls = ms = 0
        for q, (n, t, _) in pg[c].items():
            if pred(q): calls += n; ms += t
        return calls, ms
    def span(c, name, field=0):
        return sp[c][field].get(name, 0)
    def test_time(c):
        p = os.path.join(root, c, 'vitest.json')
        if not os.path.exists(p): return float('nan'), 0, 0
        j = json.load(open(p)); t = n = f = 0
        for tr in j['testResults']:
            for a in tr['assertionResults']:
                t += (a.get('duration') or 0); n += 1; f += a['status'] == 'failed'
        return t / 1000, n, f
    notpgss = lambda q: 'pg_stat_statements' not in q
    pin_stmt = lambda q: '"sandbox_script"' in q and 'plugin_config_revision' in q and 'jsonb_object_agg' in q
    metrics = {
        'T0.db_seconds': lambda c: sum(v[1] for q, v in pg[c].items() if notpgss(q)) / 1000,
        'T0.queries': lambda c: sum(v[0] for q, v in pg[c].items() if notpgss(q)),
        'T0.test_seconds': lambda c: test_time(c)[0],
        'T0.tests_failed': lambda c: test_time(c)[2],
        'I1.authority_view_calls': lambda c: pg_sum(c, lambda q: 'plugin_revision_sandbox_authority' in q)[0],
        'I1.script_pin_query_mean_ms': lambda c: (lambda x: x[1] / x[0] if x[0] else 0)(pg_sum(c, lambda q: q.startswith('select "sandbox_script"."id", "sandbox_script"."slug", "plugin"."status"'))),
        'I1.revision_script_list_rows': lambda c: sum(v[2] for q, v in pg[c].items() if q.startswith('select "slug", "content_hash" from "sandbox_script" where "sandbox_script"."plugin_revision_id"')),
        'I1.write_path_manifest_shape_calls': lambda c: pg_sum(c, lambda q: q.startswith('select "plugin_revision"."manifest" from "plugin_revision" inner join "plugin" on "plugin"."id" = "plugin_revision"."plugin_id" inner join "sandbox_script"') or q.startswith('select "plugin_revision"."manifest" from "plugin" inner join "plugin_revision" on (("plugin"."active_revision_id"') or 'plugin_revision_sandbox_authority' in q)[0],
        'I4.pin_statement_calls': lambda c: pg_sum(c, pin_stmt)[0],
        'I4.pin_statement_mean_ms': lambda c: (lambda x: x[1] / x[0] if x[0] else 0)(pg_sum(c, pin_stmt)),
        'I4.get_script_pin_spans': lambda c: span(c, 'SandboxRepository.getScriptPin'),
        'I4.legacy_pin_shape_calls': lambda c: pg_sum(c, lambda q: q.startswith('select "sandbox_script"."id", "sandbox_script"."slug", "plugin"."status"') or q.startswith('select "slug", "content_hash" from "sandbox_script" where "sandbox_script"."plugin_revision_id"') or q.startswith('select "owner_user_id", "encrypted_payload", "plugin_revision_id" from "plugin_config_revision"'))[0],
        'I2/I3/I5.manifest_reading_queries': lambda c: pg_sum(c, lambda q: notpgss(q) and re.search(r'"manifest"|revision\.manifest|\bmanifest\s*->', q) is not None and 'plugin_revision' in q)[0],
        'I2.shared_lock_calls': lambda c: pg_sum(c, lambda q: q.startswith('select pg_advisory_xact_lock_shared'))[0],
        'I2.account_state_reads': lambda c: pg_sum(c, lambda q: q.startswith('select "disabled_at"::text, "account_generation" from "user"'))[0],
        'I2.installation_state_reads': lambda c: pg_sum(c, lambda q: q.startswith('select "uninstalled_at"::text, "ingestion_retiring", "incompatibility_reason" from "plugin_installation"') or q.startswith('select "plugin_installation"."id", "user"."disabled_at"::text'))[0],
        'I2/I4.authority_resolve_calls': lambda c: span(c, 'SandboxExecutionAuthority.resolve'),
        'I2/I4.authority_resolve_seconds': lambda c: span(c, 'SandboxExecutionAuthority.resolve', 1) / 1000,
        'I4.durable_host_service_seconds': lambda c: span(c, 'SandboxDurableHostServiceWorkflow', 1) / 1000,
        'I5.user_sandbox_provider_view_ms': lambda c: pg_sum(c, lambda q: 'user_sandbox_provider' in q)[1],
        'I7.event_create_activities_per_run': lambda c: span(c, 'Workflow/EventCreateWorkflow.client.activity') / max(1, span(c, 'Workflow/EventCreateWorkflow(*).run')),
        'I7.resolve_event_scopes_spans': lambda c: span(c, 'resolveEventCreateItemScopes'),
        'I7.event_create_seconds': lambda c: span(c, 'EventCreateWorkflow', 1) / 1000,
        'I8.gc_admit_spans': lambda c: span(c, 'WorkflowGarbageCollectionRepository.admit'),
        'I8.cluster_message_inserts': lambda c: pg_sum(c, lambda q: q.startswith('INSERT INTO "cluster_messages"'))[0],
        'I9.user_bootstrap_seconds': lambda c: span(c, 'UserBootstrapWorkflow', 1) / 1000,
        'I9.user_bootstrap_runs': lambda c: span(c, 'UserBootstrapWorkflow'),
        'I9.bootstrap_resolve_spans': lambda c: span(c, 'PluginRuntimeResolver.resolveUserInstallationBootstraps'),
        'I9.dispatch_all_spans': lambda c: span(c, 'PluginUserBootstrapDispatcher.dispatchAll'),
        'I9.no_entry_complete_spans': lambda c: span(c, 'PluginInstallationRepository.completeNoEntryInitializations'),
        'I10.receipt_admit_account_spans': lambda c: span(c, 'MutationReceipts.admitAccount'),
        'I10.receipt_lock_account_spans': lambda c: span(c, 'MutationReceipts.lockAccount'),
        'I13.prepare_chunk_over_2500ms': lambda c: sum(b.get('+Inf', 0) - b.get('2500', 0) for n, b in bk[c].items() if n.startswith('prepare-chunk-')),
    }
    print(f"{'metric':42s} " + ' '.join(f"{c:>14s}" for c in commits))
    for k, f in metrics.items():
        print(f"{k:42s} " + ' '.join(f"{f(c):14.2f}" for c in commits))

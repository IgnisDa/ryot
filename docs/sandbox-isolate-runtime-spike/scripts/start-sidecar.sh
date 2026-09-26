#!/bin/sh
[ -f /root/spike/sidecar.pid ] && kill $(cat /root/spike/sidecar.pid) 2>/dev/null; sleep 0.3
cd /root/spike && nohup ./sidecar/target/release/sidecar serve snap.bin runtime /root/spike/sidecar.sock ${1:-8} > sidecar.log 2>&1 &
echo $! > /root/spike/sidecar.pid; sleep 0.5

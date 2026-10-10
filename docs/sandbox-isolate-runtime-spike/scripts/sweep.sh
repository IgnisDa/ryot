#!/bin/sh
export PATH=$PATH:/root/.bun/bin
OUT=/root/spike/sweep.jsonl
: > $OUT
n_for() { case $1 in noop) echo 200;; host5) echo 200;; cpu) echo 30;; esac; }
for rep in 1 2; do
  for w in noop host5 cpu; do
    ./start-sidecar.sh 128; sleep 1
    echo "{\"idleSidecarRssMiB\": $(grep VmRSS /proc/$(cat sidecar.pid)/status | awk "{print int(\$2/1024)}"), \"rep\": $rep, \"workload\": \"$w\"}" >> $OUT
    for c in 1 2 5 20; do
      timeout 600 bun driver.ts sidecar $w $(n_for $w) $c 256 30000 256 >> $OUT; sleep 2
      timeout 600 bun driver.ts deno $w $(n_for $w) $c >> $OUT; sleep 2
    done
    [ $w = host5 ] && { timeout 600 bun driver.ts sidecar host5 500 100 256 30000 256 >> $OUT; sleep 2; }
  done
done
echo SWEEP_DONE >> $OUT

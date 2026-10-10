#!/bin/sh
export PATH=$PATH:/root/.bun/bin
cd /root/spike; cp snap-full.bin snap.bin; ./start-sidecar.sh 32; sleep 2
P=$(cat sidecar.pid); rss() { grep VmRSS /proc/$P/status | awk "{print int(\$2/1024)}"; }
echo "start rss=$(rss)" > soak.out
for w in 1 2 3 4 5 6 7 8 9 10; do
  timeout 300 bun driver.ts sidecar host5 500 20 256 30000 256 > /dev/null
  a=$(rss); sleep 60; b=$(rss)
  echo "wave $w after=$a idle60s=$b" >> soak.out
done
echo SOAK_DONE >> soak.out

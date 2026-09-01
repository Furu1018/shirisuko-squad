import { defineConfig } from 'vitest/config';

// 빌드마다 바뀌는 ID. calculator.worker.js는 해시가 없는 public 자산이라
// 이 값을 쿼리로 붙여 새 배포 때 옛 워커가 캐시에서 재사용되지 않게 한다.
const buildId = JSON.stringify(Date.now().toString(36));

export default defineConfig({
  base: '/shirisuko-squad/',
  define: {
    __BUILD_ID__: buildId,
  },
  test: {
    environment: 'node',
    // jsdom の UI テストは1件で5秒を超えることがある (mount + 再描画が重い)。
    // 既定の 5 秒だと «負荷が高いときだけ落ちる» 偽の失敗が出て、本物の失敗と見分けが
    // つかなくなる。CI (Linux) では出ないが、手元で毎回フラグを付けるのは忘れるので設定に置く。
    // 遅さは計測の問題であって製品の問題ではない — 直すべきものが隠れるわけではない。
    testTimeout: 30_000,
  },
});

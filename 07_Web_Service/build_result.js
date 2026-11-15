// Counts belong to the current engine run, not to every file retained in its folder.
export function readBuildResult(stdout) {
  const line = String(stdout).split(/\r?\n/).findLast(line => line.startsWith('ISAF_BUILD_RESULT '));
  if (!line) throw new Error('The build engine did not return document counts. Refresh the engine bundle.');
  const result = JSON.parse(line.slice('ISAF_BUILD_RESULT '.length));
  for (const key of ['generatedCount', 'reusedCount', 'failCount']) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0) throw new Error('Invalid build document counts.');
  }
  return {...result, docCount: result.generatedCount + result.reusedCount};
}

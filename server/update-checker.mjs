const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function validRepository(value) {
  return typeof value === 'string' && REPOSITORY_PATTERN.test(value);
}

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(String(value || '').trim());
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function safeAsset(asset) {
  return {
    name: String(asset.name || ''),
    downloadUrl: String(asset.browser_download_url || ''),
    sha256: typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')
      ? asset.digest.slice('sha256:'.length)
      : null,
  };
}

function unavailable(code) {
  return { enabled: true, status: 'unavailable', code };
}

export function createUpdateChecker({ repository, currentVersion, fetchImpl = fetch }) {
  const enabled = validRepository(repository);

  return Object.freeze({
    async check() {
      if (!enabled) return { enabled: false, status: 'disabled' };

      let response;
      try {
        response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'ai-token-dashboard-update-check',
          },
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        return unavailable('network');
      }

      if (response.status === 404) return unavailable('not-found');
      if (response.status === 403 || response.status === 429) return unavailable('rate-limit');
      if (!response.ok) return unavailable('network');

      let release;
      try {
        release = await response.json();
      } catch {
        return unavailable('invalid-release');
      }
      if (release.draft || release.prerelease || !parseVersion(release.tag_name)) {
        return unavailable('invalid-release');
      }

      const comparison = compareVersions(release.tag_name, currentVersion);
      if (comparison == null) return unavailable('invalid-version');
      return {
        enabled: true,
        status: comparison > 0 ? 'available' : 'current',
        currentVersion,
        latestVersion: release.tag_name.replace(/^v/, ''),
        releaseUrl: String(release.html_url || ''),
        notes: String(release.body || ''),
        assets: Array.isArray(release.assets) ? release.assets.map(safeAsset).filter((asset) => asset.downloadUrl) : [],
      };
    },
  });
}

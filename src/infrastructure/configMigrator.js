const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function migrateProjectConfig(config, targetSchemaVersion) {
  const sourceVersion = parseSemVer(config?.schemaVersion);
  const targetVersion = parseSemVer(targetSchemaVersion);

  if (!sourceVersion || !targetVersion) {
    return {
      config,
      migrated: false,
      readOnly: true,
      reason: 'invalid_semver',
    };
  }

  if (sourceVersion.major !== targetVersion.major) {
    return {
      config,
      migrated: false,
      readOnly: true,
      reason: 'major_mismatch',
    };
  }

  const needsMigration =
    sourceVersion.minor !== targetVersion.minor ||
    sourceVersion.patch !== targetVersion.patch;

  if (!needsMigration) {
    return {
      config,
      migrated: false,
      readOnly: false,
      reason: 'up_to_date',
    };
  }

  return {
    config: { ...config, schemaVersion: targetSchemaVersion },
    migrated: true,
    readOnly: false,
    reason: 'minor_auto_migrated',
  };
}

function parseSemVer(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(SEMVER_PATTERN);
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

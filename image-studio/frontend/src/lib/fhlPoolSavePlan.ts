export type FHLPoolStoredCredential = {
  index: number;
  profileId: string;
  apiKey: string;
};

export type FHLPoolCredentialMove = {
  fromIndex: number;
  fromProfileId: string;
  toIndex: number;
};

export type FHLPoolDraftMerge = {
  fromIndex: number;
  toIndex: number;
};

export type FHLPoolNormalizedTargetKeys = {
  targetKeys: Map<number, string>;
  draftMerges: FHLPoolDraftMerge[];
};

export type FHLPoolStoredCredentialSnapshot = {
  credentials: FHLPoolStoredCredential[];
  readErrors: Array<{ index: number; profileId: string }>;
};

export type FHLPoolSavePlan = {
  targetIndexes: number[];
  overwriteIndexes: number[];
  moves: FHLPoolCredentialMove[];
  draftMerges: FHLPoolDraftMerge[];
  cleanupProfileIds: string[];
};

export type FHLPoolCredentialTransaction = {
  writeTarget: (index: number, apiKey: string) => Promise<string>;
  readTarget: (index: number, profileId: string) => Promise<string>;
  cleanupSource: (profileId: string) => Promise<void>;
};

export async function readFHLPoolStoredCredentials(
  profiles: readonly ({ id: string } | null)[],
  readCredential: (profileId: string) => Promise<string>,
): Promise<FHLPoolStoredCredentialSnapshot> {
  const credentials: FHLPoolStoredCredential[] = [];
  const readErrors: FHLPoolStoredCredentialSnapshot["readErrors"] = [];
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    if (!profile) continue;
    try {
      const apiKey = (await readCredential(profile.id)).trim();
      if (apiKey) credentials.push({ index, profileId: profile.id, apiKey });
    } catch {
      readErrors.push({ index, profileId: profile.id });
    }
  }
  return { credentials, readErrors };
}

export function normalizeFHLPoolTargetKeys(
  targetKeys: ReadonlyMap<number, string>,
): FHLPoolNormalizedTargetKeys {
  const normalized = new Map<number, string>();
  const firstIndexByKey = new Map<string, number>();
  const draftMerges: FHLPoolDraftMerge[] = [];
  const entries = [...targetKeys.entries()].sort(([left], [right]) => left - right);
  for (const [index, apiKey] of entries) {
    const firstIndex = firstIndexByKey.get(apiKey);
    if (firstIndex !== undefined) {
      draftMerges.push({ fromIndex: index, toIndex: firstIndex });
      continue;
    }
    firstIndexByKey.set(apiKey, index);
    normalized.set(index, apiKey);
  }
  return { targetKeys: normalized, draftMerges };
}

export function createFHLPoolSavePlan(
  targetKeys: ReadonlyMap<number, string>,
  storedCredentials: readonly FHLPoolStoredCredential[],
  draftMerges: readonly FHLPoolDraftMerge[] = [],
): FHLPoolSavePlan {
  const targetIndexes = [...targetKeys.keys()].sort((left, right) => left - right);
  const overwriteIndexes: number[] = [];
  const moves: FHLPoolCredentialMove[] = [];
  const cleanupProfileIds = new Set<string>();

  for (const targetIndex of targetIndexes) {
    const targetKey = targetKeys.get(targetIndex) ?? "";
    const targetStored = storedCredentials.find((entry) => entry.index === targetIndex);
    if (targetStored?.apiKey && targetStored.apiKey !== targetKey) {
      overwriteIndexes.push(targetIndex);
    }
    for (const source of storedCredentials) {
      if (source.index === targetIndex || source.apiKey !== targetKey) continue;
      if (targetKeys.has(source.index) && targetKeys.get(source.index) === source.apiKey) continue;
      moves.push({
        fromIndex: source.index,
        fromProfileId: source.profileId,
        toIndex: targetIndex,
      });
      if (!targetKeys.has(source.index)) cleanupProfileIds.add(source.profileId);
    }
  }

  moves.sort((left, right) => left.fromIndex - right.fromIndex || left.toIndex - right.toIndex);
  return {
    targetIndexes,
    overwriteIndexes: [...new Set(overwriteIndexes)],
    moves,
    draftMerges: [...draftMerges],
    cleanupProfileIds: [...cleanupProfileIds],
  };
}

export function fhlPoolSaveConfirmation(plan: FHLPoolSavePlan): string {
  const parts: string[] = [];
  if (plan.overwriteIndexes.length > 0) {
    parts.push(`覆盖 ${plan.overwriteIndexes.map((index) => `API ${index + 1}`).join("、")}`);
  }
  if (plan.moves.length > 0) {
    parts.push(`迁移 ${plan.moves.map((move) => `API ${move.fromIndex + 1} 到 API ${move.toIndex + 1}`).join("、")}`);
  }
  if (plan.draftMerges.length > 0) {
    parts.push(`合并 ${plan.draftMerges.map((move) => `API ${move.fromIndex + 1} 到 API ${move.toIndex + 1}`).join("、")}`);
  }
  return parts.length > 0
    ? `将${parts.join("；")}。同一 API 只保留新槽位，是否继续？`
    : "";
}

export async function executeFHLPoolSavePlan(
  targetKeys: ReadonlyMap<number, string>,
  plan: FHLPoolSavePlan,
  transaction: FHLPoolCredentialTransaction,
): Promise<{ targetProfileIds: Map<number, string> }> {
  const targetProfileIds = new Map<number, string>();
  let savedCount = 0;
  for (const [index, apiKey] of targetKeys.entries()) {
    try {
      const profileId = await transaction.writeTarget(index, apiKey);
      targetProfileIds.set(index, profileId);
      savedCount += 1;
    } catch {
      throw new Error(`API ${index + 1} 保存失败；此前可能已保存 ${savedCount} 个槽位。`);
    }
  }

  for (const [index, expectedKey] of targetKeys.entries()) {
    const profileId = targetProfileIds.get(index);
    if (!profileId) throw new Error(`API ${index + 1} 保存后校验失败；已写入 ${savedCount} 个目标槽，旧重复槽尚未清理。`);
    let storedKey = "";
    try {
      storedKey = (await transaction.readTarget(index, profileId)).trim();
    } catch {
      throw new Error(`API ${index + 1} 保存后回读失败；已写入 ${savedCount} 个目标槽，旧重复槽尚未清理。`);
    }
    if (storedKey !== expectedKey) {
      throw new Error(`API ${index + 1} 保存后校验不一致；已写入 ${savedCount} 个目标槽，旧重复槽尚未清理。`);
    }
  }

  for (const profileId of plan.cleanupProfileIds) {
    const move = plan.moves.find((candidate) => candidate.fromProfileId === profileId);
    if (!move) continue;
    try {
      await transaction.cleanupSource(profileId);
    } catch {
      throw new Error(`API ${move.fromIndex + 1} 重复配置清理失败；新槽已安全保存，请稍后清理该旧槽。`);
    }
  }

  return { targetProfileIds };
}

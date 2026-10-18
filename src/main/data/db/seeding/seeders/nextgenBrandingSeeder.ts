import { and, eq, isNull, notInArray } from 'drizzle-orm'

import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { preferenceTable } from '@data/db/schemas/preference'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { CHERRY_CLOUD_PROVIDER_ID, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'

import type { DbType, ISeeder } from '../../types'
import { DEFAULT_MODEL_PREFERENCE_KEYS } from './cherryaiDefaultModelSeeder'

const LEGACY_AGENT_NAMES: Record<string, string> = {
  'Cherry Assistant': 'NextGen Assistant',
  'Cherry 小助手': 'NextGen 小助手',
  'Cherry Support': 'NextGen Support',
  'Cherry Doctor': 'NextGen Doctor'
}
const CHERRY_PROVIDER_IDS = [CHERRYAI_PROVIDER_ID, CHERRY_CLOUD_PROVIDER_ID, 'cherryin']

/**
 * NextGen AI fork: renames built-in Agents created under the Cherry brand and moves
 * defaults off the CherryAI model, which this build cannot call (no client secret).
 */
export class NextgenBrandingSeeder implements ISeeder {
  readonly name = 'nextgenBranding'
  readonly description = 'Rename legacy Cherry built-in Agents and replace the CherryAI default model'

  // Runs every start so defaults move once the user configures a working provider.
  get version(): string {
    return String(Date.now())
  }

  run(db: DbType): void {
    db.transaction(
      (tx) => {
        for (const agent of tx.select().from(agentTable).where(isNull(agentTable.deletedAt)).all()) {
          if (!agent.configuration?.builtin_role) continue
          const name = LEGACY_AGENT_NAMES[agent.name] ?? agent.name
          const avatar = agent.configuration.avatar === '🍒' ? '🤖' : agent.configuration.avatar
          if (name === agent.name && avatar === agent.configuration.avatar) continue
          tx.update(agentTable)
            .set({ name, configuration: { ...agent.configuration, avatar } })
            .where(eq(agentTable.id, agent.id))
            .run()
        }

        const candidates = tx
          .select({ id: userModelTable.id })
          .from(userModelTable)
          .innerJoin(userProviderTable, eq(userProviderTable.providerId, userModelTable.providerId))
          .where(
            and(
              eq(userProviderTable.isEnabled, true),
              eq(userModelTable.isEnabled, true),
              eq(userModelTable.isHidden, false),
              notInArray(userModelTable.providerId, CHERRY_PROVIDER_IDS)
            )
          )
          .all()
          .map((row) => row.id)
        const replacement =
          candidates.find((id) => id.includes('claude-haiku-5-5')) ??
          candidates.find((id) => id.startsWith('anthropic::')) ??
          candidates[0]
        if (!replacement) return

        for (const key of DEFAULT_MODEL_PREFERENCE_KEYS) {
          tx.update(preferenceTable)
            .set({ value: replacement })
            .where(
              and(
                eq(preferenceTable.scope, 'default'),
                eq(preferenceTable.key, key),
                eq(preferenceTable.value, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
              )
            )
            .run()
        }
        tx.update(assistantTable)
          .set({ modelId: replacement })
          .where(eq(assistantTable.modelId, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
          .run()
      },
      { behavior: 'immediate' }
    )
  }
}

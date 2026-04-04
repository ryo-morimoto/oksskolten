import useSWR from 'swr'
import { useI18n } from '../../../lib/i18n'
import { fetcher } from '../../../lib/fetcher'

/** Profile section — shows the GitHub username as read-only.
 *  The username is determined server-side from GITHUB_ALLOWED_USERNAME. */
export function ProfileSection() {
  const { t } = useI18n()
  const { data: profile } = useSWR<{ github_username: string; language?: string }>(
    '/api/settings/profile',
    fetcher,
  )

  return (
    <section>
      <h2 className="text-base font-semibold text-text mb-4">{t('settings.profile')}</h2>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-bg-avatar flex items-center justify-center text-lg font-semibold text-muted shrink-0 select-none">
          {profile?.github_username?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div>
          <p className="text-sm text-text font-medium">
            {profile?.github_username ?? '—'}
          </p>
          <p className="text-xs text-muted">GitHub</p>
        </div>
      </div>
    </section>
  )
}

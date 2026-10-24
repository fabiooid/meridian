import type { Metadata } from 'next'
import PageShell from '@/components/page-shell'
import StatusAlert from '@/components/status-alert'
import { adminPageGate } from '@/lib/admin-ui'
import AdminEditions from './admin-editions'

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
}

export default function AdminPage() {
  const gate = adminPageGate()
  if (!gate.ok) {
    return (
      <PageShell>
        <StatusAlert
          tone="error"
          title="Admin is not available"
          description="The admin key is not set on the server. This page stays closed until that key is configured."
        />
      </PageShell>
    )
  }

  return <AdminEditions />
}

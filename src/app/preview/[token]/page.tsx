import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Breadcrumbs from '@/components/breadcrumbs'
import EditionViewBlock from '@/components/edition-view'
import PageShell from '@/components/page-shell'
import StatusAlert from '@/components/status-alert'
import { getEditionByPreviewToken } from '@/lib/queries/editions'

export const metadata: Metadata = {
  title: 'Private preview',
  robots: { index: false, follow: false },
}

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const edition = await getEditionByPreviewToken(token).catch(() => null)
  if (!edition) notFound()

  return (
    <>
      <PageShell className="pb-0">
        <Breadcrumbs
          items={[
            { label: 'Home', to: '/' },
            { label: 'Preview' },
          ]}
        />
        <StatusAlert
          title="Private preview"
          description="This page is a private look at the draft. Approve or reject it with the admin API, not from this page."
        />
      </PageShell>
      <EditionViewBlock edition={edition} preview />
    </>
  )
}

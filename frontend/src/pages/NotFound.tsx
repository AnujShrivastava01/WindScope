import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/ui/feedback'

export default function NotFound() {
  return (
    <EmptyState
      className="mt-10"
      title="Page not found"
      description="The page you requested does not exist."
      action={
        <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
          Back to Overview
        </Link>
      }
    />
  )
}

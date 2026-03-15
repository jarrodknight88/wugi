import Link from "next/link"

export default function UnauthorizedPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center p-6">
      <div className="w-full space-y-4 rounded border border-neutral-300 p-6">
        <h1 className="text-2xl font-semibold">Unauthorized</h1>
        <p className="text-sm text-neutral-700">
          Your account is signed in, but it does not have permission to access
          the admin dashboard.
        </p>
        <p className="text-sm text-neutral-700">
          Please contact a super admin if you believe this is a mistake.
        </p>
        <div className="flex gap-2">
          <Link
            href="/login"
            className="rounded border border-neutral-300 px-4 py-2 text-sm"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </main>
  )
}

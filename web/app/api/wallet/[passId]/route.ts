import { NextRequest, NextResponse } from "next/server"
import { adminDb, adminStorage } from "@/lib/firebase-admin"

export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ passId: string }> }
) {
  const { passId } = await params

  try {
    // Look up the pass doc to get the orderId / storage path
    const passDoc = await adminDb.collection("passes").doc(passId).get()

    let storagePath: string | null = null

    if (passDoc.exists) {
      const data = passDoc.data()!
      const passUrl = data.appleWalletPassUrl || data.passUrl
      if (passUrl) {
        // Extract storage path from the Firebase Storage public URL
        // URL format: https://storage.googleapis.com/{bucket}/passes/{orderId}.pkpass
        const match = passUrl.match(/\/passes\/([^?]+\.pkpass)/)
        if (match) storagePath = `passes/${match[1]}`
      }
    }

    // Fallback: try orderId-based path
    if (!storagePath && passDoc.exists) {
      const orderId = passDoc.data()?.orderId
      if (orderId) storagePath = `passes/${orderId}.pkpass`
    }

    if (!storagePath) {
      return NextResponse.json({ error: "Pass not found" }, { status: 404 })
    }

    // Fetch from Firebase Storage
    const bucket = adminStorage.bucket()
    const file   = bucket.file(storagePath)
    const [exists] = await file.exists()
    if (!exists) {
      return NextResponse.json({ error: "Pass file not found" }, { status: 404 })
    }

    const [buffer] = await file.download()

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":        "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename="wugi-pass.pkpass"`,
        "Cache-Control":       "no-store",
      },
    })
  } catch (err) {
    console.error("Wallet proxy error:", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

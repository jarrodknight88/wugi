import { readFileSync } from "fs"
import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"

const serviceAccount = JSON.parse(
  readFileSync(new URL("./serviceAccount.json", import.meta.url), "utf-8")
)

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: "wugi-prod",
})

const db = getFirestore(app)

const events = [
  {
    title: "Ladies Night at Compound",
    venueName: "Compound",
    date: "2026-04-01",
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  },
  {
    title: "ATL Rooftop Sessions",
    venueName: "The Roof",
    date: "2026-04-05",
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  },
  {
    title: "Friday Night Live",
    venueName: "Suite Food Lounge",
    date: "2026-04-12",
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  },
]

async function seed() {
  for (const event of events) {
    const ref = await db.collection("events").add(event)
    console.log(`Added "${event.title}" with ID: ${ref.id}`)
  }
  console.log("Done. 3 test events seeded.")
}

seed().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})

"use client"

import { useEffect } from "react"
import { db } from "../lib/firebase"
import { collection, getDocs } from "firebase/firestore"

export default function Home() {

  useEffect(() => {
    async function testFirestore() {
      try {
        const querySnapshot = await getDocs(collection(db, "test"))
        console.log("Connected to Firestore!", querySnapshot)
      } catch (error) {
        console.error("Firestore connection error:", error)
      }
    }

    testFirestore()
  }, [])

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">
        Wugi Admin Dashboard
      </h1>

      <p className="mt-4">
        Firebase connection test running...
      </p>
    </main>
  )
}
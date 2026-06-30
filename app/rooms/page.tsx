"use client"

import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import type { Room } from "@shared/schema"

export default function RoomSelectionPage() {
  const router = useRouter()

  const { data: rooms, isLoading } = useQuery<Room[]>({
    queryKey: ["/api/rooms"],
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[hsl(207,90%,54%)] mx-auto mb-4" />
          <p className="text-gray-600">Loading rooms...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-12">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-[hsl(198,18%,21%)] mb-3 text-balance">Select Your Round</h1>
          <p className="text-gray-600 text-lg">Choose your training round</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-8 sm:gap-10 max-w-5xl mx-auto">
          {rooms?.map((room) => (
            <button
              key={room.id}
              type="button"
              onClick={() => router.push(`/room/${room.id}`)}
              className="flex flex-col items-center cursor-pointer group touch-manipulation select-none focus:outline-none"
              style={{ WebkitTapHighlightColor: "transparent" }}
            >
              <div className="relative">
                <div className="w-24 h-24 rounded-full border-4 border-black bg-white flex items-center justify-center shadow-2xl transition-all duration-300 group-hover:scale-110 group-hover:border-blue-600 group-active:scale-95">
                  <span className="text-3xl font-bold text-black group-hover:text-blue-600 transition-colors duration-300">
                    {room.number}
                  </span>
                </div>
                <div className="absolute inset-0 rounded-full bg-blue-400 opacity-0 group-hover:opacity-20 transition-opacity duration-300 blur-md" />
              </div>
              <p className="mt-4 text-sm text-gray-500 text-center max-w-[120px] group-hover:text-gray-700 transition-colors duration-200 font-medium">
                {room.name.includes("(") ? room.name.split(" (")[1]?.replace(")", "") : room.name}
              </p>
            </button>
          ))}
        </div>

        <div className="text-center mt-8">
          <Button
            onClick={() => router.push("/")}
            variant="outline"
            className="bg-gray-500 hover:bg-gray-600 text-white border-gray-500 hover:border-gray-600 touch-manipulation select-none"
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      </div>
    </div>
  )
}

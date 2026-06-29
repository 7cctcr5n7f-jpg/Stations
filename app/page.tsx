"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Users, Lock, Calendar } from "lucide-react"

export default function RoleSelectionPage() {
  const router = useRouter()
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState("")

  const handleAdminClick = () => {
    setIsPasswordModalOpen(true)
    setPassword("")
    setPasswordError("")
  }

  const handlePasswordSubmit = () => {
    if (password === "1708") {
      setIsPasswordModalOpen(false)
      router.push("/admin")
    } else {
      setPasswordError("Incorrect password")
      setPassword("")
    }
  }

  const handlePasswordKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handlePasswordSubmit()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <Card className="w-full max-w-md mx-4 shadow-2xl">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <div className="w-32 h-32 mx-auto mb-6 flex items-center justify-center">
              <Image
                src="/logo.png"
                alt="10 Rounds Logo"
                width={128}
                height={128}
                className="w-full h-full object-contain"
                priority
              />
            </div>
            <p className="text-gray-600">Choose your access level</p>
          </div>

          <div className="space-y-4">
            <Button
              onClick={handleAdminClick}
              className="w-full bg-gray-500 hover:bg-gray-600 text-white font-semibold py-4 px-6 h-auto touch-manipulation select-none"
              style={{ WebkitTapHighlightColor: "transparent" }}
              size="lg"
            >
              <Lock className="mr-3 h-5 w-5" />
              Admin
            </Button>

            <Button
              onClick={() => router.push("/equipment")}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-4 px-6 h-auto touch-manipulation select-none"
              style={{ WebkitTapHighlightColor: "transparent" }}
              size="lg"
            >
              <Calendar className="mr-3 h-5 w-5" />
              View Workouts
            </Button>

            <Button
              onClick={() => router.push("/rooms")}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 h-auto touch-manipulation select-none"
              style={{ WebkitTapHighlightColor: "transparent" }}
              size="lg"
            >
              <Users className="mr-3 h-5 w-5" />
              Select Round...
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Lock className="mr-2 h-5 w-5" />
              Admin Access
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Please enter the admin password to continue.</p>
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={handlePasswordKeyPress}
                className="text-center"
                autoFocus
              />
              {passwordError && <p className="text-sm text-red-500 text-center">{passwordError}</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsPasswordModalOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handlePasswordSubmit} className="flex-1 bg-gray-500 hover:bg-gray-600">
                Access Admin
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

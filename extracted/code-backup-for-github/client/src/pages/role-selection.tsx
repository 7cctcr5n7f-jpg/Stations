import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserRoundCheck, Users, Lock, Calendar } from "lucide-react";
import logoPath from "@assets/10Rounds Logos_RGB-08_1750068981660.png";

export default function RoleSelection() {
  const [, setLocation] = useLocation();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const handleAdminClick = () => {
    setIsPasswordModalOpen(true);
    setPassword("");
    setPasswordError("");
  };

  const handlePasswordSubmit = () => {
    if (password === "1708") {
      setIsPasswordModalOpen(false);
      setLocation("/admin");
    } else {
      setPasswordError("Incorrect password");
      setPassword("");
    }
  };

  const handlePasswordKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handlePasswordSubmit();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <Card className="w-full max-w-md mx-4 shadow-2xl">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <div className="w-32 h-32 mx-auto mb-6 flex items-center justify-center">
              <img 
                src={logoPath} 
                alt="TENROUNDS Logo" 
                className="w-full h-full object-contain"
              />
            </div>
            <p className="text-gray-600">Choose your access level</p>
          </div>
          
          <div className="space-y-4">
            <Button
              onClick={handleAdminClick}
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.transition = 'transform 0.1s ease-out';
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                setTimeout(() => handleAdminClick(), 100);
              }}
              onTouchCancel={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
              className="w-full bg-gray-500 hover:bg-gray-600 text-white font-semibold py-4 px-6 h-auto touch-manipulation select-none"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              size="lg"
            >
              <Lock className="mr-3 h-5 w-5" />
              Admin
            </Button>
            
            <Button
              onClick={() => setLocation("/equipment")}
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.transition = 'transform 0.1s ease-out';
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                setTimeout(() => setLocation("/equipment"), 100);
              }}
              onTouchCancel={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-4 px-6 h-auto touch-manipulation select-none"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              size="lg"
            >
              <Calendar className="mr-3 h-5 w-5" />
              View Workouts
            </Button>

            <Button
              onClick={() => setLocation("/rooms")}
              onTouchStart={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.transition = 'transform 0.1s ease-out';
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                setTimeout(() => setLocation("/rooms"), 100);
              }}
              onTouchCancel={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 h-auto touch-manipulation select-none"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              size="lg"
            >
              <Users className="mr-3 h-5 w-5" />
              Select Round...
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Password Modal */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Lock className="mr-2 h-5 w-5" />
              Admin Access
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Please enter the admin password to continue.
            </p>
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
              {passwordError && (
                <p className="text-sm text-red-500 text-center">{passwordError}</p>
              )}
            </div>
            <div className="flex space-x-2">
              <Button
                variant="outline"
                onClick={() => setIsPasswordModalOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handlePasswordSubmit}
                className="flex-1 bg-gray-500 hover:bg-gray-600"
              >
                Access Admin
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

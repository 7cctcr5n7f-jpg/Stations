import { Card, CardContent } from "@/components/ui/card";
import { getRoomColorClasses } from "@/lib/utils";
import type { Room } from "@shared/schema";

interface RoomCardProps {
  room: Room;
  onClick: () => void;
}

export default function RoomCard({ room, onClick }: RoomCardProps) {
  const { colorClass, borderClass } = getRoomColorClasses(room.number);
  
  return (
    <Card 
      className={`cursor-pointer border-2 border-transparent hover:${borderClass} hover:shadow-xl transition-all duration-200`}
      onClick={onClick}
    >
      <CardContent className="p-6 text-center">
        <div className={`w-16 h-16 ${colorClass} rounded-full flex items-center justify-center mx-auto mb-4`}>
          <span className="text-white text-xl font-bold">{room.number}</span>
        </div>
        <div className="mb-2">
          <h3 className="font-semibold text-[hsl(198,18%,21%)]">
            {room.name.split(' (')[0]}
          </h3>
          {room.name.includes('(') && (
            <p className="text-sm text-gray-400 mt-1">
              {room.name.split(' (')[1]?.replace(')', '')}
            </p>
          )}
        </div>
        <p className="text-sm text-gray-500">
          {room.isActive ? "Active" : "Inactive"}
        </p>
      </CardContent>
    </Card>
  );
}

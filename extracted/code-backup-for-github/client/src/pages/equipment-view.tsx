import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { getRoomColorClasses } from "@/lib/utils";
import type { Room, Video } from "@shared/schema";

export default function EquipmentView() {
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [, setLocation] = useLocation();

  // Generate consistent colors for equipment (more prominent)
  const getEquipmentColor = (equipment: string) => {
    // Custom colors for specific equipment (more prominent)
    const customColors: { [key: string]: string } = {
      'TRX': 'bg-yellow-400 text-black border-yellow-500',
      'Battle Rope': 'bg-gray-800 text-white border-gray-900',
      'Bodyweight': 'bg-white text-gray-700 border-gray-400',
      'Boxing Bag': 'bg-white text-gray-700 border-gray-400',
      'Multi functional wall': 'bg-white text-gray-700 border-gray-400'
    };
    
    // Check for custom color first
    if (customColors[equipment]) {
      return customColors[equipment];
    }
    
    // More prominent colors
    const colors = [
      'bg-red-500 text-white border-red-600',
      'bg-blue-500 text-white border-blue-600',
      'bg-green-500 text-white border-green-600',
      'bg-purple-500 text-white border-purple-600',
      'bg-pink-500 text-white border-pink-600',
      'bg-indigo-500 text-white border-indigo-600',
      'bg-orange-500 text-white border-orange-600',
      'bg-teal-500 text-white border-teal-600',
      'bg-cyan-500 text-white border-cyan-600',
      'bg-emerald-500 text-white border-emerald-600',
      'bg-lime-500 text-black border-lime-600',
      'bg-amber-500 text-black border-amber-600',
    ];
    
    // Simple hash function for consistent color assignment
    let hash = 0;
    for (let i = 0; i < equipment.length; i++) {
      hash = ((hash << 5) - hash + equipment.charCodeAt(i)) & 0xffffffff;
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const { data: rooms } = useQuery<Room[]>({
    queryKey: ["/api/rooms"],
  });

  const { data: videos } = useQuery<Video[]>({
    queryKey: ["/api/videos"],
  });

  const { data: weekSchedules = [] } = useQuery<any[]>({
    queryKey: ["/api/schedules", "all"],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/schedules`);
        if (!response.ok) {
          throw new Error(`Failed to fetch all schedules: ${response.status}`);
        }
        return response.json();
      } catch (error) {
        console.log('All schedules fetch error:', error);
        return [];
      }
    },
    staleTime: 1000, // Reduce cache time to 1 second for real-time updates
    refetchOnWindowFocus: true,
  });

  // Calculate week dates
  const getWeekDates = () => {
    const currentDateObj = new Date(currentDate);
    const currentDay = currentDateObj.getDay();
    const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
    const weekStart = new Date(currentDateObj);
    weekStart.setDate(currentDateObj.getDate() - daysFromMonday);
    
    const dates = [];
    for (let i = 0; i < 6; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      const dateString = date.toISOString().split('T')[0];
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNumber = date.getDate();
      dates.push({ dateString, dayName, dayNumber });
    }
    return dates;
  };

  const weekDates = getWeekDates();

  // Group schedules by room and date
  const getSchedulesForRoomAndDate = (roomId: number, dateString: string) => {
    return weekSchedules
      .filter((s: any) => s.roomId === roomId && s.scheduleDate === dateString)
      .map((schedule: any) => {
        const video = videos?.find((v: any) => v.id === schedule.videoId);
        return {
          ...schedule,
          video,
        };
      })
      .sort((a: any, b: any) => a.position - b.position);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-gray-900">Equipment Planning View</h1>
            
            <div className="flex items-center space-x-4">
              {/* Exit Button */}
              <Button
                onClick={() => setLocation("/")}
                variant="outline"
                className="bg-gray-500 hover:bg-gray-600 text-white border-gray-500 hover:border-gray-600"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
              
              {/* Week Navigation */}
              <Button
                onClick={() => {
                  const currentWeekStart = new Date(currentDate);
                  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
                  setCurrentDate(currentWeekStart.toISOString().split('T')[0]);
                }}
                variant="outline"
                size="sm"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous Week
              </Button>
              
              <span className="text-sm text-gray-600">
                Week of {weekDates[0]?.dayName} {weekDates[0]?.dayNumber} - {weekDates[5]?.dayName} {weekDates[5]?.dayNumber}
              </span>
              
              <Button
                onClick={() => {
                  const currentWeekStart = new Date(currentDate);
                  currentWeekStart.setDate(currentWeekStart.getDate() + 7);
                  setCurrentDate(currentWeekStart.toISOString().split('T')[0]);
                }}
                variant="outline"
                size="sm"
              >
                Next Week
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
          
          <p className="text-gray-600">
            Equipment planning overview - see what equipment is needed in each room throughout the week
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Weekly Equipment Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-center p-3 font-medium text-gray-700 w-20">Round</th>
                    {weekDates.map(({ dateString, dayName, dayNumber }) => (
                      <th key={dateString} className="text-center p-3 font-medium text-gray-700 min-w-[200px]">
                        <div>
                          <div className="text-sm">{dayName}</div>
                          <div className="text-xs text-gray-500">{dayNumber}</div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rooms?.slice().sort((a, b) => a.number - b.number).map((room, roomIndex) => {
                    const { colorClass } = getRoomColorClasses(room.number);
                    
                    return (
                      <tr 
                        key={room.id}
                        className={`border-b border-gray-100 ${
                          roomIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                        }`}
                      >
                        <td className={`p-3 text-center font-medium ${colorClass} rounded-lg m-1`}>
                          Round {room.number}
                        </td>
                        
                        {weekDates.map(({ dateString }) => {
                          const schedules = getSchedulesForRoomAndDate(room.id, dateString);
                          
                          return (
                            <td key={`${room.id}-${dateString}`} className="p-3 align-top">
                              <div className="space-y-1">
                                {schedules.length === 0 ? (
                                  <div className="text-xs text-gray-400 italic">No workouts</div>
                                ) : (
                                  schedules.map((schedule: any, index: number) => (
                                    <div key={schedule.id} className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
                                      <div className="font-medium text-xs text-gray-900 mb-1 line-clamp-2">
                                        {schedule.displayTitle || schedule.video?.title || 'Unknown Video'}
                                      </div>
                                      <div className="text-xs text-gray-600 flex flex-wrap gap-1 mt-1">
                                        {(() => {
                                          // Show only selected equipment, not all possible equipment
                                          const equipmentToShow = schedule.displayEquipment || 
                                            (schedule.video?.equipment?.split(',').length === 1 ? 
                                              schedule.video.equipment.split(',')[0]?.trim() : 
                                              'No equipment selected');
                                          
                                          if (equipmentToShow === 'No equipment selected' || equipmentToShow === 'No equipment' || !equipmentToShow) {
                                            return <span className="text-xs text-gray-400 italic">No equipment selected</span>;
                                          }
                                          
                                          return equipmentToShow.split(',').map((eq: string, eqIndex: number) => {
                                            const equipment = eq.trim();
                                            if (!equipment) return null;
                                            return (
                                              <span
                                                key={`${schedule.id}-eq-${eqIndex}`}
                                                className={`inline-block px-1.5 py-0.5 text-xs rounded border ${getEquipmentColor(equipment)}`}
                                              >
                                                {equipment}
                                              </span>
                                            );
                                          }).filter(Boolean);
                                        })()}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Equipment Summary */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Equipment Summary for Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {weekDates.map(({ dateString, dayName, dayNumber }) => {
                // Get all equipment needed for this day
                const dayEquipment = new Set<string>();
                rooms?.forEach(room => {
                  const schedules = getSchedulesForRoomAndDate(room.id, dateString);
                  schedules.forEach((schedule: any) => {
                    // Show only selected equipment, not all possible equipment
                    const equipment = schedule.displayEquipment || 
                      (schedule.video?.equipment?.split(',').length === 1 ? 
                        schedule.video.equipment.split(',')[0]?.trim() : 
                        null);
                    if (equipment && equipment !== 'No equipment' && equipment.trim() !== '') {
                      equipment.split(',').forEach((eq: string) => {
                        const trimmed = eq.trim();
                        if (trimmed) dayEquipment.add(trimmed);
                      });
                    }
                  });
                });

                return (
                  <div key={dateString} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h4 className="font-semibold text-gray-900 mb-2">
                      {dayName} {dayNumber}
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {dayEquipment.size === 0 ? (
                        <span className="text-xs text-gray-500 italic">No equipment needed</span>
                      ) : (
                        Array.from(dayEquipment).map((equipment) => (
                          <span
                            key={equipment}
                            className={`inline-block px-2 py-1 text-xs rounded-md border ${getEquipmentColor(equipment)}`}
                          >
                            {equipment}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
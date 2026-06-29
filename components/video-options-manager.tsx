import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

interface VideoOptionsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  category: 'bodyPart' | 'secondaryMuscle' | 'equipment';
  options: string[];
  title: string;
}

export function VideoOptionsManager({ isOpen, onClose, category, options, title }: VideoOptionsManagerProps) {
  const [newItem, setNewItem] = useState('');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const apiEndpoints = {
    bodyPart: '/api/video-options/add-body-part',
    secondaryMuscle: '/api/video-options/add-secondary-muscle',
    equipment: '/api/video-options/add-equipment'
  };

  const fieldNames = {
    bodyPart: 'bodyPart',
    secondaryMuscle: 'secondaryMuscle', 
    equipment: 'equipment'
  };

  const handleAddItem = async () => {
    if (!newItem.trim()) return;
    
    setIsAdding(true);
    try {
      await apiRequest("POST", apiEndpoints[category], { [fieldNames[category]]: newItem.trim() });
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
      setNewItem('');
      toast({
        title: "Success",
        description: `${newItem} has been added to ${title.toLowerCase()}`
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to add ${newItem}`,
        variant: "destructive"
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteItem = async (item: string) => {
    setIsDeleting(item);
    try {
      const response = await apiRequest("DELETE", `/api/video-options/${category}/${encodeURIComponent(item)}`);
      const result = await response.json();
      
      // Invalidate both video options and videos queries since we update existing videos
      queryClient.invalidateQueries({ queryKey: ["/api/video-options"] });
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      
      toast({
        title: "Success",
        description: result.videosUpdated > 0 
          ? `${item} has been removed and ${result.videosUpdated} videos updated`
          : `${item} has been removed from ${title.toLowerCase()}`
      });
    } catch (error) {
      toast({
        title: "Error", 
        description: `Failed to delete ${item}`,
        variant: "destructive"
      });
    } finally {
      setIsDeleting(null);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddItem();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage {title}</DialogTitle>
          <DialogDescription>
            Add new options or remove existing ones from the {title.toLowerCase()} list.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Add New Item Section */}
          <div className="space-y-2">
            <Label htmlFor="new-item">Add New Item</Label>
            <div className="flex gap-2">
              <Input
                id="new-item"
                placeholder={`Enter new ${title.toLowerCase().slice(0, -1)}`}
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <Button 
                onClick={handleAddItem} 
                disabled={!newItem.trim() || isAdding}
                size="sm"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Existing Options List */}
          <div className="space-y-2">
            <Label>Current Options ({options.length})</Label>
            <div className="max-h-64 overflow-y-auto border rounded p-2 space-y-1">
              {options.map((option) => (
                <div key={option} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded">
                  <span className="text-sm">{option}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteItem(option)}
                    disabled={isDeleting === option}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {options.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">
                  No options available. Add some above.
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface VideoOptionsButtonProps {
  category: 'bodyPart' | 'secondaryMuscle' | 'equipment';
  options: string[];
  title: string;
}

export function VideoOptionsButton({ category, options, title }: VideoOptionsButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsModalOpen(true)}
        className="flex items-center justify-center text-xs h-7 w-7 p-0"
        title={`Manage ${title}`}
      >
        <Settings className="h-3 w-3" />
      </Button>
      <VideoOptionsManager
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        category={category}
        options={options}
        title={title}
      />
    </>
  );
}
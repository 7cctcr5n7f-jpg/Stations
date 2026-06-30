"use client"

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertTriangle, XCircle, RefreshCw, Trash2, HardDrive } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface VideoValidationResult {
  id: number;
  title: string;
  url: string;
  status: 'valid' | 'missing_file' | 'invalid_path' | 'corrupt';
  fileSize?: number;
  error?: string;
}

interface VideoHealth {
  total: number;
  valid: number;
  missing: number;
  corrupt: number;
  invalid: number;
  totalFileSize: number;
  details: VideoValidationResult[];
}

export default function VideoHealthDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isValidating, setIsValidating] = useState(false);

  const { data: health, isLoading } = useQuery<VideoHealth>({
    queryKey: ["/api/videos/health"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: validationResults } = useQuery<VideoValidationResult[]>({
    queryKey: ["/api/videos/validate"],
    enabled: false, // Only run when manually triggered
  });

  const cleanupMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/videos/cleanup-invalid'),
    onSuccess: (data: any) => {
      toast({
        title: "Cleanup Complete",
        description: `Removed ${data.deleted || 0} invalid videos`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/videos/health"] });
    },
    onError: () => {
      toast({
        title: "Cleanup Failed",
        description: "Failed to cleanup invalid videos",
        variant: "destructive",
      });
    },
  });

  const integrityCheckMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/videos/verify-integrity'),
    onSuccess: (data: any) => {
      toast({
        title: "File Integrity Check Complete",
        description: `Removed ${data.orphanedRecords || 0} orphaned records. Found ${data.missingFiles || 0} untracked files.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/videos/health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: () => {
      toast({
        title: "Integrity Check Failed",
        description: "Failed to verify file integrity",
        variant: "destructive",
      });
    },
  });

  const validateVideos = async () => {
    setIsValidating(true);
    try {
      await queryClient.refetchQueries({ queryKey: ["/api/videos/validate"] });
      await queryClient.refetchQueries({ queryKey: ["/api/videos/health"] });
    } finally {
      setIsValidating(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'valid':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'missing_file':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'corrupt':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'invalid_path':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'valid':
        return <Badge variant="default" className="bg-green-100 text-green-800">Valid</Badge>;
      case 'missing_file':
        return <Badge variant="destructive">Missing File</Badge>;
      case 'corrupt':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-700">Corrupt</Badge>;
      case 'invalid_path':
        return <Badge variant="destructive">Invalid Path</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <HardDrive className="h-5 w-5" />
            <span>Video Health Dashboard</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            <span>Checking video health...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const healthPercentage = health ? Math.round((health.valid / health.total) * 100) : 0;
  const hasIssues = health && (health.missing > 0 || health.invalid > 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <HardDrive className="h-5 w-5" />
              <span>Video Health Dashboard</span>
            </div>
            <div className="flex space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={validateVideos}
                disabled={isValidating}
              >
                {isValidating ? (
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Validate All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => integrityCheckMutation.mutate()}
                disabled={integrityCheckMutation.isPending}
              >
                {integrityCheckMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <HardDrive className="h-4 w-4 mr-2" />
                )}
                Fix Files
              </Button>
              {hasIssues && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => cleanupMutation.mutate()}
                  disabled={cleanupMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Cleanup Invalid
                </Button>
              )}
            </div>
          </CardTitle>
          <CardDescription>
            Monitor your Cloudflare R2 video library
          </CardDescription>
        </CardHeader>
        <CardContent>
          {health ? (
            <div className="space-y-4">
              {/* Overall Health */}
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{health.valid}</div>
                  <div className="text-sm text-gray-600">Reachable</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{health.missing}</div>
                  <div className="text-sm text-gray-600">Unreachable</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{health.invalid}</div>
                  <div className="text-sm text-gray-600">Invalid URL</div>
                </div>
              </div>

              {/* Health Status */}
              <div className="flex items-center space-x-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Overall Health</span>
                    <span className="text-sm text-gray-600">{healthPercentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        healthPercentage >= 90 ? 'bg-green-500' :
                        healthPercentage >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${healthPercentage}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Status alert */}
              {hasIssues ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {health.missing + health.invalid} videos have issues and may not play in rooms.
                  </AlertDescription>
                </Alert>
              ) : health.total > 0 ? (
                <Alert>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700">
                    All {health.total} videos are reachable on Cloudflare R2.
                  </AlertDescription>
                </Alert>
              ) : null}

              {/* Problem Videos */}
              {health.details && health.details.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-red-600">Videos with Issues ({health.details.length}):</h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {health.details.map((video) => (
                      <div key={video.id} className="flex items-center justify-between p-3 border rounded-lg bg-red-50">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(video.status)}
                          <div>
                            <div className="font-medium">{video.title}</div>
                            <div className="text-sm text-gray-500 truncate max-w-sm">{video.url}</div>
                          </div>
                        </div>
                        {getStatusBadge(video.status)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No health data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
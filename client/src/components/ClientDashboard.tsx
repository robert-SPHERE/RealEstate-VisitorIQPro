import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { queryClient } from "@/lib/queryClient";
import { Mail, TrendingUp, BarChart, Plus, Download, Clock, Calendar as CalendarIcon, User as UserIcon, Home, RefreshCw, Loader2 } from "lucide-react";
import type { User, Campaign } from "@shared/schema";
import BusinessDataTable from "./BusinessDataTable";
import EmailLookup from "./EmailLookup";

interface ClientDashboardProps {
  user: User;
  selectedCid: string;
}

export default function ClientDashboard({ user, selectedCid }: ClientDashboardProps) {
  const { toast } = useToast();
  const [timePeriod, setTimePeriod] = useState<string>("30d");
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: undefined,
    to: undefined,
  });
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  // Fetch dashboard stats with time period filtering and selected CID
  const { data: stats } = useQuery<any>({
    queryKey: ['/api/dashboard-stats', selectedCid, timePeriod, customDateRange.from, customDateRange.to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCid !== 'all') {
        params.append('cid', selectedCid);
        console.log(`Client dashboard requesting data for CID: ${selectedCid}`);
      }
      params.append('timePeriod', timePeriod);
      if (timePeriod === 'custom' && customDateRange.from && customDateRange.to) {
        params.append('fromDate', customDateRange.from.toISOString());
        params.append('toDate', customDateRange.to.toISOString());
      }
      
      console.log(`Requesting: /api/dashboard-stats?${params.toString()}`);
      const res = await fetch(`/api/dashboard-stats?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const data = await res.json();
      console.log(`Client dashboard received data:`, data);
      return data;
    },
    retry: false,
  });

  // Fetch recent identity captures for selected CID
  const { data: recentCaptures } = useQuery<any[]>({
    queryKey: ['/api/recent-captures', selectedCid],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCid !== 'all') params.append('cid', selectedCid);
      
      const res = await fetch(`/api/recent-captures?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return await res.json();
    },
    retry: false,
  });

  const getEnrichmentStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const userName = user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}` 
    : user.email?.split('@')[0] || 'User';

  const handleSyncIdentities = async () => {
    setSyncLoading(true);
    
    try {
      const res = await fetch('/api/sync-website-identities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: "include",
      });
      
      if (!res.ok) {
        if (res.status === 401) {
          toast({
            title: "Authentication Required",
            description: "Please log in to sync identities",
            variant: "destructive",
          });
          return;
        }
        throw new Error(`${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      
      toast({
        title: "Sync Complete",
        description: `Successfully synced ${data.synced || 0} website identities`,
      });
      
      // Refresh the dashboard data
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recent-captures"] });
      
    } catch (error) {
      console.error("Identity sync error:", error);
      toast({
        title: "Sync Failed",
        description: "Failed to sync website identities. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Client Overview */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                Welcome back, {userName}
              </h2>
              <p className="text-sm text-gray-600">
                Here's your identity resolution overview
              </p>
            </div>
            <div className="flex items-center gap-4">

              
              {/* Time Period Filter */}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500" />
                <Select value={timePeriod} onValueChange={setTimePeriod}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Time Period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">Last 7 Days</SelectItem>
                    <SelectItem value="30d">Last 30 Days</SelectItem>
                    <SelectItem value="90d">Last 90 Days</SelectItem>
                    <SelectItem value="1y">Last Year</SelectItem>
                    <SelectItem value="all">All Time</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Date Range Picker */}
              {timePeriod === 'custom' && (
                <Popover open={showCustomDatePicker} onOpenChange={setShowCustomDatePicker}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[200px] justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customDateRange.from ? (
                        customDateRange.to ? (
                          <>
                            {format(customDateRange.from, "MMM d")} - {format(customDateRange.to, "MMM d, yyyy")}
                          </>
                        ) : (
                          format(customDateRange.from, "MMM d, yyyy")
                        )
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <div className="flex">
                      <Calendar
                        mode="range"
                        defaultMonth={customDateRange.from}
                        selected={customDateRange}
                        onSelect={(range) => setCustomDateRange({ from: range?.from, to: range?.to })}
                        numberOfMonths={2}
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              )}


            </div>
          </div>
        </CardContent>
      </Card>

      {/* Identity Resolution Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-l-4 border-l-green-500 hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="relative">
              <div className="mb-4">
                <p className="text-sm text-gray-600">Hashed Emails</p>
                <p className="text-3xl font-bold text-gray-900">
                  {(stats?.totalEmailCaptures || 0).toLocaleString()}
                </p>
              </div>
              <div className="absolute bottom-0 right-0 p-2 bg-green-100 rounded-lg">
                <UserIcon className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500 hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="relative">
              <div className="mb-4">
                <p className="text-sm text-gray-600">Contact Emails</p>
                <p className="text-3xl font-bold text-gray-900">
                  {(stats?.plainTextEmails || 0).toLocaleString()}
                </p>
              </div>
              <div className="absolute bottom-0 right-0 p-2 bg-purple-100 rounded-lg">
                <Mail className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500 hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="relative">
              <div className="mb-4">
                <p className="text-sm text-gray-600">Household Addresses</p>
                <p className="text-3xl font-bold text-gray-900">
                  {(stats?.enrichedCount || 0).toLocaleString()}
                </p>
              </div>
              <div className="absolute bottom-0 right-0 p-2 bg-orange-100 rounded-lg">
                <Home className="h-5 w-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sync Button */}
      <div className="flex justify-center">
        <Button 
          onClick={handleSyncIdentities} 
          disabled={syncLoading}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 text-base font-medium"
        >
          {syncLoading ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="h-5 w-5 mr-2" />
              Sync Website Identities
            </>
          )}
        </Button>
      </div>

      {/* Recent Identity Captures */}
      <Card className="shadow-sm">
        <CardHeader className="bg-gray-50 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Recent Identity Captures</CardTitle>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              Website Traffic
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentCaptures && recentCaptures.length > 0 ? (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="text-left py-4 px-6 font-semibold text-gray-900 text-xs uppercase tracking-wider">
                      Hashed Email
                    </th>
                    <th className="text-left py-4 px-6 font-semibold text-gray-900 text-xs uppercase tracking-wider">
                      First and Last Name
                    </th>
                    <th className="text-left py-4 px-6 font-semibold text-gray-900 text-xs uppercase tracking-wider">
                      Email
                    </th>
                    <th className="text-left py-4 px-6 font-semibold text-gray-900 text-xs uppercase tracking-wider">
                      Last Visit Date
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recentCaptures.map((capture: any) => (
                    <tr key={capture.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-4 px-6 font-mono text-xs text-gray-700 break-all max-w-xs">
                        {capture.hashedEmail || 'N/A'}
                      </td>
                      <td className="py-4 px-6 font-medium text-gray-900">
                        {capture.firstName || capture.lastName 
                          ? `${capture.firstName || ''} ${capture.lastName || ''}`.trim()
                          : <span className="text-gray-400 italic">N/A</span>
                        }
                      </td>
                      <td className="py-4 px-6 text-gray-700">
                        {capture.email || <span className="text-gray-400 italic">N/A</span>}
                      </td>
                      <td className="py-4 px-6">
                        {capture.capturedAt ? (
                          <span className="text-gray-700">
                            {new Date(capture.capturedAt).toLocaleDateString('en-US', {
                              month: '2-digit',
                              day: '2-digit',
                              year: 'numeric'
                            })}
                          </span>
                        ) : <span className="text-gray-400 italic">N/A</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Mail className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-lg text-gray-600 mb-2">No identity captures yet</p>
              <p className="text-sm text-gray-500">Identities will appear here as visitors interact with your website</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Lookup Section */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Email Lookup</CardTitle>
          <p className="text-sm text-gray-600">
            Enter an email address to view the complete identity profile
          </p>
        </CardHeader>
        <CardContent>
          <EmailLookup />
        </CardContent>
      </Card>

    </div>
  );
}
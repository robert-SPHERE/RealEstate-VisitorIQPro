import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Search, Mail, User, MapPin, DollarSign, Calendar, Phone } from "lucide-react";
import { BUSINESS_TYPE_FIELDS } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";

interface EmailLookupProps {}

export default function EmailLookup({}: EmailLookupProps) {
  const [email, setEmail] = useState("");
  const [searchTriggered, setSearchTriggered] = useState(false);
  const [searchEmail, setSearchEmail] = useState("");
  const [searchResult, setSearchResult] = useState<any>(null);
  const { toast } = useToast();

  // API call to lookup email
  const emailLookupMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await fetch(`/api/email-lookup?email=${encodeURIComponent(email)}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      setSearchResult(data);
      setSearchTriggered(true);
    },
    onError: (error: Error) => {
      console.error("Email lookup error:", error);
      
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      
      toast({
        title: "Error",
        description: "Failed to lookup email. Please try again.",
        variant: "destructive",
      });
      setSearchResult({ success: false, message: "Failed to lookup email" });
      setSearchTriggered(true);
    },
  });



  const handleSearch = () => {
    if (!email.trim()) return;
    setSearchEmail(email);
    
    // Lookup email using API data
    emailLookupMutation.mutate(email);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const formatCurrency = (value: number | string) => {
    // If value already contains $, return as-is (for ranges like "$150K to $174K")
    if (typeof value === 'string' && value.includes('$')) {
      return value;
    }
    // For numeric values, format as currency
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) {
      // If it's not a number and doesn't have $, return original value
      return value;
    }
    return `$${num.toLocaleString()}`;
  };

  // Utility function to format URLs for display
  const formatUrl = (url: string, maxLength: number = 40): { display: string; full: string } => {
    if (!url || url === 'N/A') return { display: 'N/A', full: '' };
    
    // Remove protocol for cleaner display
    const cleanUrl = url.replace(/^https?:\/\//, '');
    
    if (cleanUrl.length <= maxLength) {
      return { display: cleanUrl, full: url };
    }
    
    // Truncate in the middle to show domain and end
    const domain = cleanUrl.split('/')[0];
    const remaining = maxLength - domain.length - 3; // 3 for "..."
    
    if (remaining > 10) {
      const endPart = cleanUrl.slice(-Math.floor(remaining / 2));
      return { 
        display: `${domain}...${endPart}`, 
        full: url 
      };
    }
    
    // If too short, just truncate normally
    return {
      display: cleanUrl.slice(0, maxLength - 3) + '...',
      full: url
    };
  };

  const formatValue = (field: string, value: any) => {
    if (!value || value === null || value === undefined || value === '') {
      return <span className="text-gray-400 italic">Data Not Available</span>;
    }
    
    switch (field) {
      // Currency fields
      case 'mortgageAmount':
      case 'householdIncome':
      case 'homePrice':
      case 'homeValue':
      case 'purchasePrice':
      case 'monthlyPayment':
      case 'annualSpend':
      case 'lifetimeValue':
      case 'averageOrderValue':
        return formatCurrency(value);
      // Date fields
      case 'birthDate':
      case 'lastVisitDate':
      case 'lastPurchaseDate':
        return new Date(value).toLocaleDateString();
      // URL fields
      case 'lastPageViewed':
      case 'url':
      case 'website':
        const formatted = formatUrl(value, 35);
        return formatted.full ? (
          <a 
            href={formatted.full} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline break-all"
            title={formatted.full}
          >
            {formatted.display}
          </a>
        ) : (
          <span className="break-all">{formatted.display}</span>
        );
      default:
        return value;
    }
  };

  const getFieldLabel = (field: string) => {
    const fields = BUSINESS_TYPE_FIELDS.real_estate;
    const fieldConfig = fields.find(f => f.key === field);
    return fieldConfig?.label || field;
  };

  const getFieldIcon = (field: string) => {
    switch (field) {
      case 'firstName':
      case 'lastName':
        return <User className="h-4 w-4" />;
      case 'email':
        return <Mail className="h-4 w-4" />;
      case 'address':
      case 'city':
      case 'state':
      case 'zip':
        return <MapPin className="h-4 w-4" />;
      case 'phone':
        return <Phone className="h-4 w-4" />;
      case 'birthDate':
      case 'lastVisitDate':
      case 'lastPurchaseDate':
        return <Calendar className="h-4 w-4" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Input */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Enter email address..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={handleKeyPress}
              className="pl-10"
            />
          </div>
          <Button onClick={handleSearch} disabled={!email.trim() || emailLookupMutation.isPending}>
            {emailLookupMutation.isPending ? "Searching..." : "Search"}
          </Button>
        </div>
        

      </div>

      {/* Results */}
      {searchTriggered && (
        <div>
          {emailLookupMutation.isPending && (
            <div className="flex items-center justify-center p-8">
              <div className="text-gray-500">Searching for profile...</div>
            </div>
          )}

          {emailLookupMutation.isError && (
            <Alert className="border-red-200 bg-red-50">
              <Mail className="h-4 w-4" />
              <AlertDescription className="text-red-700">
                Error searching for email. Please try again.
              </AlertDescription>
            </Alert>
          )}

          {searchResult && !searchResult.found && (
            <Alert className="border-yellow-200 bg-yellow-50">
              <Mail className="h-4 w-4" />
              <AlertDescription className="text-yellow-700">
                {searchResult.message || `No profile found for "${searchEmail}"`}
              </AlertDescription>
            </Alert>
          )}

          {searchResult && searchResult.found && searchResult.profile && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    {searchResult.profile.firstName} {searchResult.profile.lastName}
                  </CardTitle>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Profile Found
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(searchResult.profile)
                    .filter(([key]) => !['id', 'hashedEmail', 'cid', 'enrichmentStatus', 'capturedAt'].includes(key))
                    .map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                        {getFieldIcon(key)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">
                            {getFieldLabel(key)}
                          </div>
                          <div className="text-sm text-gray-600 truncate">
                            {formatValue(key, value)}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
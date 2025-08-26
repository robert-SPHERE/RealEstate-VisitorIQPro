import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { 
  Shield, 
  Users, 
  Building, 
  Mail, 
  TrendingUp, 
  BarChart3, 
  Database, 
  Filter,
  Eye,
  CheckCircle,
  AlertCircle,
  Clock,
  Activity,
  Plus,
  Edit,
  Home,
  Car,
  Calendar as CalendarIcon,
  User,
  Upload,
  FileText,
  Loader2,
  RefreshCw,
  Globe,
  TestTube,
  Key,
  UserPlus,
  PenTool,
  Terminal,
  Search,
  Download,
  ExternalLink
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { User as UserType } from "@shared/schema";
import { EnrichmentTestButton } from "./EnrichmentTestButton";
import { UserManagement } from "./UserManagement";

interface AdminDashboardProps {
  user: UserType;
  selectedCid: string;
  onCidChange: (cid: string) => void;
}

const businessIcon = Home;
const businessLabel = "Real Estate";

// Utility function to format URLs for display
const formatUrl = (url: string, maxLength: number = 50): { display: string; full: string } => {
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

export default function AdminDashboard({ user, selectedCid, onCidChange }: AdminDashboardProps) {
  const [timePeriod, setTimePeriod] = useState<string>("30d");
  const [activeTab, setActiveTab] = useState("overview");
  const [newAccountDialog, setNewAccountDialog] = useState(false);
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: undefined,
    to: undefined,
  });
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);

  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupResults, setLookupResults] = useState<any>(null);
  const [verifyCredentialsLoading, setVerifyCredentialsLoading] = useState(false);
  
  // System logs state
  const [systemLogsFilter, setSystemLogsFilter] = useState({
    eventType: 'all',
    source: 'all',
    limit: 50
  });
  const [lookupLoading, setLookupLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [testEnrichmentLoading, setTestEnrichmentLoading] = useState(false);

  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testMd5Input, setTestMd5Input] = useState("");
  const [lastTestResult, setLastTestResult] = useState<any>(null);

  const [viewAccountDialog, setViewAccountDialog] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [showAccountCreatedDialog, setShowAccountCreatedDialog] = useState(false);
  const [createdAccountData, setCreatedAccountData] = useState<any>(null);
  const [uploadDialog, setUploadDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadCid, setUploadCid] = useState<string>("");
  const [showFieldMapping, setShowFieldMapping] = useState(false);
  const [fieldMappingData, setFieldMappingData] = useState<any>(null);
  const [dialogStep, setDialogStep] = useState<'upload' | 'verify'>('upload');
  const [manualMappings, setManualMappings] = useState<Record<string, string>>({});

  // Available database fields for manual mapping with proper labels
  const availableFields = [
    { key: 'id', label: 'Record ID' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'email', label: 'Email Address' },
    { key: 'hashedEmail', label: 'Hashed Email' },
    { key: 'address', label: 'Street Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP Code' },
    { key: 'gender', label: 'Gender' },
    { key: 'birthDate', label: 'Date of Birth' },
    { key: 'age', label: 'Age' },
    { key: 'mortgageLoanType', label: 'Mortgage Loan Type' },
    { key: 'mortgageAmount', label: 'Mortgage Amount (USD)' },
    { key: 'mortgageAge', label: 'Mortgage Age (Years)' },
    { key: 'householdIncome', label: 'Household Income (USD)' },
    { key: 'homeOwnership', label: 'Home Ownership' },
    { key: 'homePrice', label: 'Home Purchase Price (USD)' },
    { key: 'homeValue', label: 'Current Home Value (USD)' },
    { key: 'lengthOfResidence', label: 'Length of Residence (Years)' },
    { key: 'maritalStatus', label: 'Marital Status' },
    { key: 'householdPersons', label: 'Household Size' },
    { key: 'householdChildren', label: 'Number of Children' },
    { key: 'lastPageViewed', label: 'Last Page Viewed' },
    { key: 'url', label: 'Website Page Visited' },
    { key: 'cid', label: 'Account Name' }
  ];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();



  // Fetch CID accounts with business type information
  const { data: cidAccounts = [], isLoading: accountsLoading } = useQuery<any[]>({
    queryKey: ["/api/cid-accounts"],
    retry: false,
  });

  // Fetch dashboard statistics
  const { data: dashboardStats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/admin/dashboard-stats", selectedCid, timePeriod, customDateRange.from, customDateRange.to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCid !== 'all') params.append('cid', selectedCid);
      params.append('timePeriod', timePeriod);
      if (timePeriod === 'custom' && customDateRange.from && customDateRange.to) {
        params.append('fromDate', customDateRange.from.toISOString());
        params.append('toDate', customDateRange.to.toISOString());
      }
      
      const res = await fetch(`/api/admin/dashboard-stats?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return await res.json();
    },
    retry: false,
  });

  // Fetch system health and integrations
  const { data: systemHealth } = useQuery({
    queryKey: ["/api/admin/system-health"],
    retry: false,
  });

  // Fetch enhanced sync status for all services
  const { data: enhancedSyncStatus = {} } = useQuery<any>({
    queryKey: ["/api/sync/status"],
    retry: false,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Extract individual service statuses from enhanced API
  const scheduledSyncStatus = enhancedSyncStatus.spherePixel || {};
  const handwryttenNightlySyncStatus = enhancedSyncStatus.handwrytten || {};
  const mailchimpSyncStatus = enhancedSyncStatus.mailchimp || {};

  // Fetch system logs
  const { data: systemLogs = [], isLoading: systemLogsLoading, refetch: refetchSystemLogs } = useQuery({
    queryKey: ["/api/admin/system-logs", systemLogsFilter.eventType, systemLogsFilter.source, systemLogsFilter.limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('limit', systemLogsFilter.limit.toString());
      if (systemLogsFilter.eventType && systemLogsFilter.eventType !== 'all') params.append('eventType', systemLogsFilter.eventType);
      if (systemLogsFilter.source && systemLogsFilter.source !== 'all') params.append('source', systemLogsFilter.source);
      
      const res = await fetch(`/api/admin/system-logs?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return await res.json();
    },
    retry: false,
    refetchInterval: 10000, // Refresh every 10 seconds for real-time logs
  });

  // Fetch recent email captures for all accounts or specific account
  const { data: recentCaptures = [] } = useQuery({
    queryKey: ["/api/recent-captures", selectedCid, timePeriod, customDateRange.from, customDateRange.to],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (selectedCid !== 'all') params.append('cid', selectedCid);
        params.append('timePeriod', timePeriod);
        if (timePeriod === 'custom' && customDateRange.from && customDateRange.to) {
          params.append('fromDate', customDateRange.from.toISOString());
          params.append('toDate', customDateRange.to.toISOString());
        }
        
        const res = await fetch(`/api/recent-captures?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) {
          console.error(`Failed to fetch recent captures: ${res.status} ${res.statusText}`);
          return [];
        }
        return await res.json();
      } catch (error) {
        console.error("Error fetching recent captures:", error);
        return [];
      }
    },
    retry: false,
  });

  // Create new CID account with user mutation
  const createAccountMutation = useMutation({
    mutationFn: async (accountData: {
      cid: string;
      accountName: string;
      accountLevel: string;
      notes?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      website?: string;
      password?: string;
      handwryttenSender?: string;
      handwritingId?: string;
      handwryttenTemplate?: string;
      returnCompany?: string;
      returnAddress1?: string;
      returnAddress2?: string;
      returnCity?: string;
      returnState?: string;
      returnZip?: string;
    }) => {
      const response = await apiRequest("POST", "/api/cid-accounts", accountData);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cid-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setNewAccountDialog(false);
      setCreatedAccountData(data);
      setShowAccountCreatedDialog(true);
      toast({
        title: "Success",
        description: `Account "${data.account.accountName}" and user "${data.user.username}" created successfully`,
      });
    },
    onError: (error: any) => {
      console.error("Account creation error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create account",
        variant: "destructive",
      });
    },
  });

  // CSV Upload mutation
  const uploadCsvMutation = useMutation({
    mutationFn: async (data: { formData?: FormData; file?: File; cid?: string; fieldMappings?: Record<string, string> }) => {
      let formData: FormData;
      
      if (data.formData) {
        formData = data.formData;
      } else {
        formData = new FormData();
        formData.append('csvFile', data.file!);
        formData.append('cid', data.cid!);
        if (data.fieldMappings) {
          formData.append('fieldMappings', JSON.stringify(data.fieldMappings));
        }
      }
      
      const response = await fetch('/api/upload-csv', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(300000), // 5 minutes timeout
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recent-captures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard-stats"] });
      setUploadDialog(false);
      setDialogStep('upload');
      setFieldMappingData(null);
      setManualMappings({});
      setSelectedFile(null);
      setUploadCid("");
      
      const headerInfo = data.headerMapping?.mappedFields 
        ? ` (${data.headerMapping.mappedFields} fields auto-mapped)`
        : '';
      
      toast({
        title: "Upload Complete",
        description: `Successfully uploaded ${data.successCount} of ${data.totalRows} records${headerInfo}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload CSV file",
        variant: "destructive",
      });
    },
  });



  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Handle field mapping verification
  const handleVerifyMapping = async () => {
    if (!selectedFile || !uploadCid) {
      toast({
        title: "Error",
        description: "Please select a file and account first",
        variant: "destructive",
      });
      return;
    }
    try {
      const text = await selectedFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        toast({
          title: "Error",
          description: "CSV file appears to be empty",
          variant: "destructive",
        });
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      
      // Field mapping logic
      const fieldMappings = {
        'email': ['email', 'Email', 'EMAIL', 'email_address', 'emailAddress'],
        'firstName': ['firstName', 'first_name', 'First Name', 'FirstName', 'fname'],
        'lastName': ['lastName', 'last_name', 'Last Name', 'LastName', 'lname'],
        'address': ['address', 'Address', 'street_address', 'streetAddress'],
        'city': ['city', 'City', 'CITY'],
        'state': ['state', 'State', 'STATE'],
        'zip': ['zip', 'Zip', 'ZIP', 'zipcode', 'zipCode'],
        'hashedEmail': ['hashedEmail', 'hashed_email', 'emailHash'],
        'mortgageAmount': ['mortgageAmount', 'mortgage_amount', 'loanAmount'],
        'homeValue': ['homeValue', 'home_value', 'propertyValue'],
        'householdIncome': ['householdIncome', 'household_income', 'income'],
        'age': ['age', 'Age', 'AGE'],
        'maritalStatus': ['maritalStatus', 'marital_status', 'married'],
        'cid': ['cid', 'CID', 'clientId'],
        'url': ['url', 'URL', 'websiteUrl']
      };

      const mappedFields: Record<string, string> = {};
      const unmappedHeaders: string[] = [];

      headers.forEach(header => {
        let mapped = false;
        for (const [dbField, variations] of Object.entries(fieldMappings)) {
          if (variations.some(v => v.toLowerCase() === header.toLowerCase())) {
            mappedFields[dbField] = header;
            mapped = true;
            break;
          }
        }
        if (!mapped) {
          unmappedHeaders.push(header);
        }
      });

      const mappingData = {
        headers,
        mappedFields,
        unmappedHeaders,
        totalRows: lines.length - 1,
        fileName: selectedFile.name
      };
      
      // Show field mapping results and allow manual mapping
      setFieldMappingData(mappingData);
      setDialogStep('verify');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to read CSV file",
        variant: "destructive",
      });
    }
  };

  // Handle confirmed upload
  const handleConfirmUpload = () => {
    // Show progress message
    toast({
      title: "Upload Started",
      description: "Processing your CSV file. This may take a few minutes for large files...",
      duration: 3000,
    });
    
    // Combine auto-mapped fields with manual mappings
    const finalMappings = {
      ...fieldMappingData.mappedFields,
      ...Object.fromEntries(
        Object.entries(manualMappings).filter(([_, value]) => value !== "" && value !== "__skip__")
      )
    };
    
    uploadCsvMutation.mutate({
      file: selectedFile!,
      cid: uploadCid,
      fieldMappings: finalMappings
    });
    setDialogStep('upload');
    setFieldMappingData(null);
    setManualMappings({});
    setSelectedFile(null);
    setUploadCid("");
  };

  // Handle account update from view dialog
  const handleUpdateAccount = async (formData: FormData) => {
    if (!selectedAccount) return;
    
    const accountData = {
      cid: formData.get('cid') as string,
      accountName: formData.get('accountName') as string,
      notes: formData.get('notes') as string,
      firstName: formData.get('firstName') as string,
      lastName: formData.get('lastName') as string,
      email: formData.get('email') as string,
      website: formData.get('website') as string,
      status: formData.get('status') as string,
      // Include Handwrytten settings in the account settings
      settings: {
        ...selectedAccount.settings,
        handwritten: {
          senderName: formData.get('handwryttenSender') as string || '',
          messageTemplate: formData.get('handwryttenTemplate') as string || '',
          handwritingId: formData.get('handwritingId') as string || '',
          returnAddress: {
            name: formData.get('returnName') as string || '',
            address1: formData.get('returnAddress1') as string || '',
            address2: formData.get('returnAddress2') as string || '',
            city: formData.get('returnCity') as string || '',
            state: formData.get('returnState') as string || '',
            zip: formData.get('returnZip') as string || '',
            country: 'US'
          }
        }
      }
    };

    try {
      await updateAccountMutation.mutateAsync({ 
        id: selectedAccount.id, 
        ...accountData 
      });
      setViewAccountDialog(false);
      toast({
        title: "Success",
        description: "Account updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update account",
        variant: "destructive",
      });
    }
  };





  // Update account mutation
  const updateAccountMutation = useMutation({
    mutationFn: async (accountData: {
      id: number;
      cid?: string;
      accountName?: string;
      notes?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      website?: string;
      status?: string;
    }) => {
      return apiRequest("PUT", `/api/cid-accounts/${accountData.id}`, accountData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cid-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard-stats"] });
      setViewAccountDialog(false);
      setSelectedAccount(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update account",
        variant: "destructive",
      });
    },
  });



  const handleCreateAccount = (formData: FormData) => {
    const password = formData.get("password") as string;
    const accountLevel = formData.get("accountLevel") as string;
    
    // Validate password length
    if (!password || password.length < 8) {
      toast({
        title: "Invalid Password",
        description: "Password must be at least 8 characters long",
        variant: "destructive",
      });
      return;
    }

    // Validate account level selection
    if (!accountLevel) {
      toast({
        title: "Account Level Required",
        description: "Please select an account level",
        variant: "destructive",
      });
      return;
    }

    const data = {
      cid: formData.get("cid") as string,
      accountName: formData.get("accountName") as string,
      accountLevel: accountLevel,
      notes: formData.get("notes") as string,
      firstName: formData.get("firstName") as string,
      lastName: formData.get("lastName") as string,
      email: formData.get("email") as string,
      website: formData.get("website") as string,
      password: password,
      // Include Handwrytten settings
      handwryttenSender: formData.get("handwryttenSender") as string,
      handwritingId: formData.get("handwritingId") as string,
      handwryttenTemplate: formData.get("handwryttenTemplate") as string,
      // Include Return Address settings
      returnCompany: formData.get("returnCompany") as string,
      returnAddress1: formData.get("returnAddress1") as string,
      returnAddress2: formData.get("returnAddress2") as string,
      returnCity: formData.get("returnCity") as string,
      returnState: formData.get("returnState") as string,
      returnZip: formData.get("returnZip") as string,
    };
    createAccountMutation.mutate(data);
  };

  const handleEmailLookup = async () => {
    if (!lookupEmail.trim()) {
      toast({
        title: "Error",
        description: "Please enter an email address to search",
        variant: "destructive",
      });
      return;
    }

    setLookupLoading(true);
    setLookupResults(null);

    try {
      const res = await fetch(`/api/email-lookup?email=${encodeURIComponent(lookupEmail)}`, {
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error(`${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      setLookupResults(data);
      
      if (!data.found) {
        toast({
          title: "No Results",
          description: "No identity found for this email address",
          variant: "default",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to search email. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSyncEmails = async () => {
    setSyncLoading(true);
    
    try {
      // Call the website identities sync endpoint  
      const res = await fetch('/api/sync-website-identities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error(`${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      
      toast({
        title: "Sync Complete",
        description: `Successfully synced ${data.synced ?? 0} website identities`,
      });
      
      // Refresh the dashboard stats
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recent-captures"] });
      
    } catch (error) {
      console.error("Email sync error:", error);
      
      // Enhanced error messaging
      let errorMessage = "Failed to sync website identities. Please try again.";
      if (error instanceof Error) {
        if (error.message.includes('fetch')) {
          errorMessage = "Couldn't contact identity service. Please check your connection and try again.";
        } else if (error.message.includes('401')) {
          errorMessage = "Authentication expired. Please refresh the page and try again.";
        } else if (error.message.includes('500')) {
          errorMessage = "Server error occurred during sync. Please try again in a few minutes.";
        }
      }
      
      toast({
        title: "Sync Failed", 
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setSyncLoading(false);
    }
  };



  // Test enrichment for a specific MD5 hash
  const handleTestEnrichment = async (md5Hash?: string) => {
    const testHash = md5Hash || testMd5Input.trim();
    
    if (!testHash) {
      toast({
        title: "MD5 Hash Required",
        description: "Please enter an MD5 hash to test enrichment",
        variant: "destructive",
      });
      return;
    }
    
    if (testHash.length !== 32) {
      toast({
        title: "Invalid MD5 Hash",
        description: "MD5 hash must be exactly 32 characters long",
        variant: "destructive",
      });
      return;
    }
    
    setTestEnrichmentLoading(true);
    setShowTestDialog(false);
    
    try {
      const res = await fetch(`/api/test-enrichment/${testHash}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error(`${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      
      setLastTestResult(data);
      
      if (data.success) {
        toast({
          title: "✅ Enrichment Test Successful",
          description: `Record ${data.recordId} enriched with ${Object.keys(data.enrichmentData || {}).length} fields from Audience Acuity`,
        });
        setTestMd5Input(""); // Clear input after successful test
      } else {
        toast({
          title: "❌ Enrichment Test Failed",
          description: data.error || `No enrichment data found for MD5: ${testHash.substring(0, 8)}...`,
          variant: "destructive",
        });
      }
      
      // Refresh the dashboard data
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recent-captures"] });
      
    } catch (error) {
      console.error("Test enrichment error:", error);
      toast({
        title: "Enrichment Test Failed",
        description: "Failed to test enrichment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setTestEnrichmentLoading(false);
    }
  };

  // Verify API credentials
  const handleVerifyCredentials = async () => {
    setVerifyCredentialsLoading(true);
    
    try {
      const res = await fetch('/api/verify-audience-acuity-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: "include",
      });
      
      const data = await res.json();
      
      if (data.success) {
        toast({
          title: "✅ Credentials Valid",
          description: data.message,
        });
      } else {
        toast({
          title: "❌ Credential Issue Detected",
          description: data.error,
          variant: "destructive",
        });
        
        // Show troubleshooting steps
        if (data.troubleshooting) {
          console.log("Troubleshooting steps:", data.troubleshooting.steps);
          console.log("Support message:", data.troubleshooting.supportMessage);
        }
      }
      
    } catch (error) {
      console.error("Credential verification error:", error);
      toast({
        title: "Verification Failed",
        description: "Failed to verify API credentials. Please try again.",
        variant: "destructive",
      });
    } finally {
      setVerifyCredentialsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Admin Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <Shield className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Real Estate Identity Resolution</h1>
              <p className="text-gray-600">Administrator Dashboard</p>
            </div>
          </div>
        </div>
        
        {/* Controls */}
        <div className="flex items-center space-x-3">
          <Filter className="h-4 w-4 text-gray-500" />
          <Select value={selectedCid} onValueChange={onCidChange}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Business Accounts</SelectItem>
              {cidAccounts.map((account: any) => (
                <SelectItem key={account.cid} value={account.cid}>
                  {account.accountName || account.cid}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Clock className="h-4 w-4 text-gray-500" />
          <Select value={timePeriod} onValueChange={(value) => {
            setTimePeriod(value);
            if (value !== "custom") {
              setCustomDateRange({ from: undefined, to: undefined });
            }
          }}>
            <SelectTrigger className="w-36">
              <SelectValue />
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

          {timePeriod === "custom" && (
            <Popover open={showCustomDatePicker} onOpenChange={setShowCustomDatePicker}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-64 justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customDateRange.from ? (
                    customDateRange.to ? (
                      <>
                        {format(customDateRange.from, "LLL dd, y")} -{" "}
                        {format(customDateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(customDateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={customDateRange.from}
                  selected={customDateRange}
                  onSelect={(range) => {
                    setCustomDateRange({ 
                      from: range?.from, 
                      to: range?.to 
                    });
                    if (range?.from && range?.to) {
                      setShowCustomDatePicker(false);
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          )}

          <Dialog open={newAccountDialog} onOpenChange={setNewAccountDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                New Account
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Business Account & User</DialogTitle>
                <DialogDescription>
                  This will create both the business account and automatically generate a primary user login
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                handleCreateAccount(formData);
              }} className="space-y-6" autoComplete="off">
                
                {/* Business Account Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium border-b pb-2">Business Account Details</h3>
                  
                  <div>
                    <Label htmlFor="cid">Client ID (CID)</Label>
                    <Input id="cid" name="cid" placeholder="e.g., realtor_smith_001" required />
                  </div>
                  <div>
                    <Label htmlFor="accountName">Account Name</Label>
                    <Input id="accountName" name="accountName" placeholder="e.g., Smith Realty Group" required />
                  </div>

                  <div>
                    <Label htmlFor="accountLevel">Account Level *</Label>
                    <Select name="accountLevel" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Select account level" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="identity_resolution">Identity Resolution</SelectItem>
                        <SelectItem value="intent_flow_accelerator">Intent Flow Accelerator</SelectItem>
                        <SelectItem value="handwritten_connect">Handwritten Connect</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="website">Website</Label>
                    <Input id="website" name="website" type="text" placeholder="e.g., www.smithrealty.com" />
                  </div>

                  <div>
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea id="notes" name="notes" placeholder="Account notes..." />
                  </div>

                  <div>
                    <Label htmlFor="status">Status</Label>
                    <Select name="status" defaultValue="active">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Handwrytten Settings Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium border-b pb-2 flex items-center">
                    <PenTool className="h-5 w-5 mr-2 text-purple-600" />
                    Handwrytten Settings
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="handwryttenSender">Sender Name</Label>
                      <Input 
                        id="handwryttenSender" 
                        name="handwryttenSender" 
                        placeholder="e.g., Robbie at Sphere DSG" 
                      />
                      <p className="text-xs text-gray-500 mt-1">Name and signature for handwritten notes</p>
                    </div>
                    <div>
                      <Label htmlFor="handwritingId">Handwriting Style ID</Label>
                      <Input 
                        id="handwritingId" 
                        name="handwritingId" 
                        placeholder="Optional handwriting style ID" 
                      />
                      <p className="text-xs text-gray-500 mt-1">Leave blank for default handwriting</p>
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor="handwryttenTemplate">Message Template</Label>
                      <Textarea 
                        id="handwryttenTemplate" 
                        name="handwryttenTemplate" 
                        placeholder="Hi {firstName},&#10;&#10;Thank you for your interest in our services! We appreciate you visiting our website and hope to connect with you soon."
                        rows={4}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Use placeholders: {'{firstName}'}, {'{lastName}'}, {'{fullName}'}, {'{company}'}, {'{city}'}, {'{state}'}
                      </p>
                    </div>
                  </div>

                  {/* Return Address Section */}
                  <div className="mt-6">
                    <h4 className="text-md font-medium text-gray-900 mb-3">Return Address (Optional)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="returnCompany">Company/Name</Label>
                        <Input 
                          id="returnCompany" 
                          name="returnCompany" 
                          placeholder="e.g., Sphere DSG" 
                        />
                      </div>
                      <div>
                        <Label htmlFor="returnAddress1">Address Line 1</Label>
                        <Input 
                          id="returnAddress1" 
                          name="returnAddress1" 
                          placeholder="e.g., 456 Market St" 
                        />
                      </div>
                      <div>
                        <Label htmlFor="returnAddress2">Address Line 2</Label>
                        <Input 
                          id="returnAddress2" 
                          name="returnAddress2" 
                          placeholder="e.g., Suite 100" 
                        />
                      </div>
                      <div>
                        <Label htmlFor="returnCity">City</Label>
                        <Input 
                          id="returnCity" 
                          name="returnCity" 
                          placeholder="e.g., Naperville" 
                        />
                      </div>
                      <div>
                        <Label htmlFor="returnState">State</Label>
                        <Input 
                          id="returnState" 
                          name="returnState" 
                          placeholder="e.g., IL" 
                        />
                      </div>
                      <div>
                        <Label htmlFor="returnZip">ZIP Code</Label>
                        <Input 
                          id="returnZip" 
                          name="returnZip" 
                          placeholder="e.g., 60540" 
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Leave blank to use Handwrytten account default return address</p>
                  </div>
                </div>

                {/* Primary User Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium border-b pb-2">Primary User Details</h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="firstName">First Name *</Label>
                      <Input id="firstName" name="firstName" placeholder="e.g., John" required />
                    </div>
                    <div>
                      <Label htmlFor="lastName">Last Name *</Label>
                      <Input id="lastName" name="lastName" placeholder="e.g., Smith" required />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="email">Email Address *</Label>
                    <Input id="email" name="email" type="email" placeholder="e.g., john@smithrealty.com" required />
                  </div>

                  <div>
                    <Label htmlFor="password" className="text-blue-700">User Password *</Label>
                    <Input 
                      id="password" 
                      name="password" 
                      type="password" 
                      placeholder="Password (8+ characters)" 
                      required 
                      minLength={8}
                      autoComplete="new-password"
                    />
                    <p className="text-sm text-gray-500 mt-1">Password must be at least 8 characters</p>
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={createAccountMutation.isPending}>
                  {createAccountMutation.isPending ? "Creating Account & User..." : "Create Account & User"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          
          <Dialog>
            <DialogTrigger asChild>
              <Button 
                variant="outline" 
                className="border-green-600 text-green-600 hover:bg-green-50"
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload CSV
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>
                  {dialogStep === 'upload' ? 'Upload CSV Data' : 'Verify Field Mapping'}
                </DialogTitle>
              </DialogHeader>
              
              {dialogStep === 'upload' && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="uploadCid">Select Account</Label>
                    <Select value={uploadCid} onValueChange={setUploadCid}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose an account..." />
                      </SelectTrigger>
                      <SelectContent>
                        {cidAccounts.map((account: any) => (
                          <SelectItem key={account.cid} value={account.cid}>
                            {account.accountName || account.cid}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="csvFile">CSV File</Label>
                    <div className="mt-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <Button 
                        variant="outline" 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        {selectedFile ? selectedFile.name : "Choose CSV file..."}
                      </Button>
                    </div>
                    {selectedFile && (
                      <p className="text-sm text-gray-500 mt-1">
                        File size: {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    )}
                  </div>
                  
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h4 className="font-medium text-blue-900 mb-2">CSV Upload</h4>
                    <ul className="text-sm text-blue-800 space-y-1">
                      <li>• Supports email, firstName, lastName, address fields</li>
                      <li>• Auto-detects common header formats</li>
                      <li>• Maximum file size: 10MB</li>
                    </ul>
                  </div>
                  
                  <div className="flex justify-end space-x-2">
                    <Button 
                      onClick={handleVerifyMapping}
                      disabled={!selectedFile || !uploadCid}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      Verify Fields
                    </Button>
                  </div>
                </div>
              )}

              {dialogStep === 'verify' && fieldMappingData && (
                <div className="space-y-4">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <h3 className="font-medium mb-2">File Information</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">File:</span> {fieldMappingData.fileName}
                      </div>
                      <div>
                        <span className="text-gray-600">Rows:</span> {fieldMappingData.totalRows}
                      </div>
                      <div>
                        <span className="text-gray-600">Account:</span> {cidAccounts.find(acc => acc.cid === uploadCid)?.accountName || uploadCid}
                      </div>
                      <div>
                        <span className="text-gray-600">Auto-Mapped Fields:</span> {Object.keys(fieldMappingData.mappedFields).length}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium text-green-700 mb-2">✓ Auto-Mapped Fields</h4>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {Object.entries(fieldMappingData.mappedFields).map(([dbField, csvHeader]) => {
                          const fieldObj = availableFields.find(f => f.key === dbField);
                          const fieldLabel = fieldObj ? fieldObj.label : dbField;
                          return (
                            <div key={dbField} className="flex justify-between text-sm p-2 bg-green-50 rounded">
                              <span className="text-gray-700">{csvHeader as string}</span>
                              <span className="text-green-700 font-medium">→ {fieldLabel}</span>
                            </div>
                          );
                        })}
                        {Object.keys(fieldMappingData.mappedFields).length === 0 && (
                          <div className="text-sm text-gray-500 italic">No fields automatically mapped</div>
                        )}
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-medium text-orange-700 mb-2">⚠ Manual Field Mapping</h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {fieldMappingData.unmappedHeaders.map((header: string, index: number) => (
                          <div key={index} className="p-2 bg-orange-50 rounded">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-orange-700 font-medium text-sm">{header}</span>
                              <Select 
                                value={manualMappings[header] || ""} 
                                onValueChange={(value) => {
                                  setManualMappings(prev => ({
                                    ...prev,
                                    [header]: value
                                  }));
                                }}
                              >
                                <SelectTrigger className="w-48">
                                  <SelectValue placeholder="Skip" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__skip__">Skip</SelectItem>
                                  {availableFields
                                    .filter(field => 
                                      !Object.values(fieldMappingData.mappedFields).includes(field.key) &&
                                      !Object.values(manualMappings).filter(v => v !== "" && v !== "__skip__" && v !== manualMappings[header]).includes(field.key)
                                    )
                                    .map(field => (
                                      <SelectItem key={field.key} value={field.key}>
                                        {field.label}
                                      </SelectItem>
                                    ))
                                  }
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ))}
                        {fieldMappingData.unmappedHeaders.length === 0 && (
                          <div className="text-sm text-gray-500 italic">All headers mapped automatically</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-blue-50 rounded-lg">
                    <div className="text-sm text-blue-800">
                      <strong>Total Fields:</strong> {Object.keys(fieldMappingData.mappedFields).length + Object.values(manualMappings).filter(v => v !== "" && v !== "__skip__").length} mapped, {fieldMappingData.unmappedHeaders.length - Object.values(manualMappings).filter(v => v !== "" && v !== "__skip__").length} will be skipped
                    </div>
                  </div>

                  <div className="flex justify-end space-x-2 pt-4">
                    <Button variant="outline" onClick={() => setDialogStep('upload')}>
                      Back
                    </Button>
                    <Button 
                      onClick={handleConfirmUpload}
                      disabled={uploadCsvMutation.isPending}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {uploadCsvMutation.isPending ? "Uploading..." : "Confirm Upload"}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>


        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-6">
            <div className="relative">
              <div className="mb-4">
                <p className="text-sm text-gray-600">Active Accounts</p>
                <p className="text-3xl font-bold text-gray-900">
                  {statsLoading ? "..." : (dashboardStats?.totalAccounts || cidAccounts.length).toLocaleString()}
                </p>
              </div>
              <div className="absolute bottom-0 right-0 p-2 bg-blue-100 rounded-lg">
                <Building className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-6">
            <div className="relative">
              <div className="mb-4">
                <p className="text-sm text-gray-600">Hashed Emails</p>
                <p className="text-3xl font-bold text-gray-900">
                  {statsLoading ? "..." : (dashboardStats?.totalEmailCaptures || 0).toLocaleString()}
                </p>
              </div>
              <div className="absolute bottom-0 right-0 p-2 bg-green-100 rounded-lg">
                <User className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-6">
            <div className="relative">
              <div className="mb-4">
                <p className="text-sm text-gray-600">Contact Emails</p>
                <p className="text-3xl font-bold text-gray-900">
                  {statsLoading ? "..." : (dashboardStats?.plainTextEmails || 0).toLocaleString()}
                </p>
              </div>
              <div className="absolute bottom-0 right-0 p-2 bg-purple-100 rounded-lg">
                <Mail className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-6">
            <div className="relative">
              <div className="mb-4">
                <p className="text-sm text-gray-600">Household Addresses</p>
                <p className="text-3xl font-bold text-gray-900">
                  {statsLoading ? "..." : (dashboardStats?.enrichedCount || 0).toLocaleString()}
                </p>
              </div>
              <div className="absolute bottom-0 right-0 p-2 bg-orange-100 rounded-lg">
                <Home className="h-5 w-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>



      {/* Action Buttons */}
      <div className="flex justify-center gap-4">
        <Button 
          onClick={handleSyncEmails} 
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



        <Button 
          onClick={() => setShowTestDialog(true)} 
          disabled={testEnrichmentLoading}
          variant="outline"
          className="border-green-600 text-green-600 hover:bg-green-50 px-6 py-3 text-base font-medium"
        >
          <TestTube className="h-5 w-5 mr-2" />
          Test Enrichment
        </Button>
      </div>

      {/* Test Results Section */}
      {lastTestResult && (
        <Card className="mx-auto max-w-4xl">
          <CardHeader>
            <CardTitle className="flex items-center">
              <TestTube className="h-5 w-5 mr-2 text-green-600" />
              Latest Enrichment Test Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Status</Label>
                  <div className="flex items-center mt-1">
                    {lastTestResult.success ? (
                      <Badge className="bg-green-100 text-green-800">Success</Badge>
                    ) : (
                      <Badge variant="destructive">Failed</Badge>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700">MD5 Hash Tested</Label>
                  <p className="font-mono text-xs mt-1 break-all">{lastTestResult.hashedEmail}</p>
                </div>
              </div>
              
              {lastTestResult.success && lastTestResult.enrichmentData ? (
                <div>
                  <Label className="text-sm font-medium text-gray-700">Enriched Data</Label>
                  <div className="mt-2 p-3 bg-gray-50 rounded-md text-xs">
                    <pre className="whitespace-pre-wrap">
                      {JSON.stringify(lastTestResult.enrichmentData, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div>
                  <Label className="text-sm font-medium text-gray-700">Error Details</Label>
                  <p className="mt-1 text-sm text-red-600">{lastTestResult.error || "No enrichment data found"}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" className="flex items-center space-x-2">
            <Eye className="h-4 w-4" />
            <span>Overview</span>
          </TabsTrigger>
          <TabsTrigger value="accounts" className="flex items-center space-x-2">
            <Building className="h-4 w-4" />
            <span>Business Accounts</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center space-x-2">
            <UserPlus className="h-4 w-4" />
            <span>User Management</span>
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="flex items-center space-x-2">
            <Activity className="h-4 w-4" />
            <span>System Monitor</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          


          {/* Recent Identity Captures */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Recent Identity Captures</span>
                <Badge variant="outline" className="text-blue-600 border-blue-200">
                  Website Traffic
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentCaptures.length > 0 ? (
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
                  <p className="text-sm text-gray-500">
                    Identities will appear here as visitors interact with your website
                    {selectedCid !== 'all' && ` for ${selectedCid}`}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Email Lookup */}
          <Card>
            <CardHeader>
              <CardTitle>Email Lookup</CardTitle>
              <p className="text-sm text-gray-600">Enter an email address to view the complete identity profile</p>
            </CardHeader>
            <CardContent>
              <div className="flex space-x-2 mb-4">
                <Input 
                  placeholder="Enter email address..." 
                  className="flex-1"
                  value={lookupEmail}
                  onChange={(e) => setLookupEmail(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleEmailLookup()}
                />
                <Button onClick={handleEmailLookup} disabled={lookupLoading}>
                  {lookupLoading ? "Searching..." : "Search"}
                </Button>
              </div>
              
              {lookupResults && (
                <div className="mt-4">
                  {lookupResults.found ? (
                    <div className="space-y-4">
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <h4 className="font-semibold text-green-800 mb-2">Identity Found</h4>
                        <p className="text-sm text-green-700">Complete identity profile for {lookupEmail}</p>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Personal Information */}
                        <div className="p-4 border rounded-lg">
                          <h5 className="font-semibold text-gray-900 mb-3">Personal Information</h5>
                          <div className="space-y-2 text-sm">
                            <div><span className="font-medium">Name:</span> {lookupResults.profile.firstName} {lookupResults.profile.lastName}</div>
                            <div><span className="font-medium">Email:</span> {lookupResults.profile.email}</div>
                            <div><span className="font-medium">Age:</span> {lookupResults.profile.age || 'N/A'}</div>
                            <div><span className="font-medium">Gender:</span> {lookupResults.profile.gender || 'N/A'}</div>
                            <div><span className="font-medium">Birth Date:</span> {lookupResults.profile.birthDate || 'N/A'}</div>
                            <div><span className="font-medium">Marital Status:</span> {lookupResults.profile.maritalStatus || 'N/A'}</div>
                          </div>
                        </div>
                        
                        {/* Address Information */}
                        <div className="p-4 border rounded-lg">
                          <h5 className="font-semibold text-gray-900 mb-3">Address Information</h5>
                          <div className="space-y-2 text-sm">
                            <div><span className="font-medium">Address:</span> {lookupResults.profile.address || 'N/A'}</div>
                            <div><span className="font-medium">City:</span> {lookupResults.profile.city || 'N/A'}</div>
                            <div><span className="font-medium">State:</span> {lookupResults.profile.state || 'N/A'}</div>
                            <div><span className="font-medium">ZIP:</span> {lookupResults.profile.zip || 'N/A'}</div>
                            <div><span className="font-medium">Length of Residence:</span> {lookupResults.profile.lengthOfResidence ? `${lookupResults.profile.lengthOfResidence} years` : 'N/A'}</div>
                          </div>
                        </div>
                        
                        {/* Real Estate Information */}
                        <div className="p-4 border rounded-lg">
                          <h5 className="font-semibold text-gray-900 mb-3">Real Estate Information</h5>
                          <div className="space-y-2 text-sm">
                            <div><span className="font-medium">Home Ownership:</span> {lookupResults.profile.homeOwnership || 'N/A'}</div>
                            <div><span className="font-medium">Home Price:</span> {lookupResults.profile.homePrice ? `$${Math.floor(lookupResults.profile.homePrice).toLocaleString()}` : 'N/A'}</div>
                            <div><span className="font-medium">Home Value:</span> {lookupResults.profile.homeValue ? `$${Math.floor(lookupResults.profile.homeValue).toLocaleString()}` : 'N/A'}</div>
                            <div><span className="font-medium">Mortgage Loan Type:</span> {lookupResults.profile.mortgageLoanType || 'N/A'}</div>
                            <div><span className="font-medium">Mortgage Amount:</span> {lookupResults.profile.mortgageAmount ? `$${Math.floor(lookupResults.profile.mortgageAmount).toLocaleString()}` : 'N/A'}</div>
                            <div><span className="font-medium">Mortgage Age:</span> {lookupResults.profile.mortgageAge ? `${lookupResults.profile.mortgageAge} years` : 'N/A'}</div>
                          </div>
                        </div>
                        
                        {/* Household Information */}
                        <div className="p-4 border rounded-lg">
                          <h5 className="font-semibold text-gray-900 mb-3">Household Information</h5>
                          <div className="space-y-2 text-sm">
                            <div><span className="font-medium">Household Income:</span> {lookupResults.profile.householdIncome || 'N/A'}</div>
                            <div><span className="font-medium">Household Persons:</span> {lookupResults.profile.householdPersons || 'N/A'}</div>
                            <div><span className="font-medium">Household Children:</span> {lookupResults.profile.householdChildren || 'N/A'}</div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Additional Information */}
                      <div className="p-4 border rounded-lg">
                        <h5 className="font-semibold text-gray-900 mb-3">Additional Information</h5>
                        <div className="space-y-2 text-sm">
                          <div><span className="font-medium">Account:</span> {lookupResults.profile.cid}</div>
                          <div className="flex items-start gap-2">
                            <span className="font-medium flex-shrink-0">Last Page Viewed:</span> 
                            {lookupResults.profile.lastPageViewed ? (
                              <div className="min-w-0 flex-1">
                                {(() => {
                                  const formatted = formatUrl(lookupResults.profile.lastPageViewed, 60);
                                  return formatted.full ? (
                                    <a 
                                      href={formatted.full} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:text-blue-800 underline break-all text-sm"
                                      title={formatted.full}
                                    >
                                      {formatted.display}
                                    </a>
                                  ) : (
                                    <span className="text-gray-700 break-all text-sm">{formatted.display}</span>
                                  );
                                })()}
                              </div>
                            ) : (
                              <span className="text-gray-500 italic">N/A</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Website URL:</span> 
                            {lookupResults.profile.url && lookupResults.profile.url !== 'N/A' ? (
                              <a 
                                href={formatUrl(lookupResults.profile.url).full.startsWith('http') ? formatUrl(lookupResults.profile.url).full : `https://${formatUrl(lookupResults.profile.url).full}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 truncate max-w-xs"
                                title={lookupResults.profile.url}
                              >
                                <span className="truncate">{formatUrl(lookupResults.profile.url, 40).display}</span>
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                              </a>
                            ) : (
                              <span className="text-gray-500">N/A</span>
                            )}
                          </div>
                          <div><span className="font-medium">Captured:</span> {lookupResults.profile.capturedAt ? format(new Date(lookupResults.profile.capturedAt), 'MMM d, yyyy h:mm a') : 'N/A'}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <h4 className="font-semibold text-yellow-800 mb-2">No Identity Found</h4>
                      <p className="text-sm text-yellow-700">No identity profile found for "{lookupEmail}"</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>


        </TabsContent>

        <TabsContent value="accounts" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Building className="h-5 w-5" />
                  <span>Business Account Management</span>
                </div>
                <Button size="sm" onClick={() => setNewAccountDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Account
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {accountsLoading ? (
                  <p className="text-center py-4">Loading accounts...</p>
                ) : cidAccounts.length > 0 ? (
                  cidAccounts.map((account: any) => {
                    return (
                      <div key={account.cid} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                        <div className="flex items-center space-x-4">
                          <div className="p-2 bg-blue-100 rounded-lg">
                            <Home className="h-5 w-5 text-blue-600" />
                          </div>
                          <div>
                            <h3 className="font-medium text-gray-900">{account.accountName || account.cid}</h3>
                          </div>
                        </div>
                        <div className="flex items-center space-x-4">
                          <div className="text-right">
                            <Badge 
                              variant={account.status === 'active' ? 'default' : 'secondary'}
                              className={account.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}
                            >
                              {account.status}
                            </Badge>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => {
                            setSelectedAccount(account);
                            setViewAccountDialog(true);
                          }}>
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>

                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-8">
                    <Building className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <p className="text-gray-500">No business accounts found</p>
                    <Button className="mt-2" onClick={() => setNewAccountDialog(true)}>
                      Create First Account
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* View/Edit Account Dialog */}
          <Dialog open={viewAccountDialog} onOpenChange={setViewAccountDialog}>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Account Details</DialogTitle>
              </DialogHeader>
              {selectedAccount && (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  handleUpdateAccount(formData);
                }} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="view-accountName">Account Name</Label>
                      <Input 
                        id="view-accountName" 
                        name="accountName" 
                        defaultValue={selectedAccount.accountName || ''} 
                        placeholder="Account name..." 
                      />
                    </div>
                    <div>
                      <Label htmlFor="view-cid">Client ID (CID)</Label>
                      <Input 
                        id="view-cid" 
                        name="cid" 
                        defaultValue={selectedAccount.cid || ''} 
                        placeholder="Client ID..." 
                      />
                    </div>
                    <div>
                      <Label htmlFor="view-accountLevel">Account Level</Label>
                      <Select name="accountLevel" defaultValue={selectedAccount.accountLevel || ''}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select account level..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Identity Resolution">Identity Resolution</SelectItem>
                          <SelectItem value="Intent Flow Accelerator">Intent Flow Accelerator</SelectItem>
                          <SelectItem value="Handwritten Connect">Handwritten Connect</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="view-firstName">First Name</Label>
                      <Input 
                        id="view-firstName" 
                        name="firstName" 
                        defaultValue={selectedAccount.firstName || ''} 
                        placeholder="First name..." 
                      />
                    </div>
                    <div>
                      <Label htmlFor="view-lastName">Last Name</Label>
                      <Input 
                        id="view-lastName" 
                        name="lastName" 
                        defaultValue={selectedAccount.lastName || ''} 
                        placeholder="Last name..." 
                      />
                    </div>
                    <div>
                      <Label htmlFor="view-email">Email</Label>
                      <Input 
                        id="view-email" 
                        name="email" 
                        type="email"
                        defaultValue={selectedAccount.email || ''} 
                        placeholder="Email address..." 
                      />
                    </div>
                    <div>
                      <Label htmlFor="view-website">Website</Label>
                      <Input 
                        id="view-website" 
                        name="website" 
                        defaultValue={selectedAccount.website || ''} 
                        placeholder="Website URL..." 
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor="view-notes">Notes</Label>
                      <Textarea 
                        id="view-notes" 
                        name="notes" 
                        defaultValue={selectedAccount.notes || ''} 
                        placeholder="Account notes..." 
                      />
                    </div>
                    <div>
                      <Label htmlFor="view-status">Status</Label>
                      <Select name="status" defaultValue={selectedAccount.status || 'active'}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Created</Label>
                      <p className="text-sm text-gray-900 mt-1">
                        {selectedAccount.createdAt ? format(new Date(selectedAccount.createdAt), 'MMM d, yyyy') : 'N/A'}
                      </p>
                    </div>
                  </div>
                  
                  {/* Handwrytten Configuration Section */}
                  <div className="border-t pt-6">
                    <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                      <Mail className="h-5 w-5 mr-2 text-purple-600" />
                      Handwrytten Settings
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="view-handwrytten-sender">Sender Name</Label>
                        <Input 
                          id="view-handwrytten-sender" 
                          name="handwryttenSender" 
                          defaultValue={selectedAccount.settings?.handwritten?.senderName || selectedAccount.settings?.handwryttenSender || ''} 
                          placeholder="e.g., Robbie at Sphere DSG" 
                        />
                        <p className="text-xs text-gray-500 mt-1">Name and signature for handwritten notes</p>
                      </div>
                      <div>
                        <Label htmlFor="view-handwrytten-handwriting">Handwriting Style ID</Label>
                        <Input 
                          id="view-handwrytten-handwriting" 
                          name="handwritingId" 
                          defaultValue={selectedAccount.settings?.handwritten?.handwritingId || selectedAccount.settings?.handwritingId || ''} 
                          placeholder="Optional handwriting style ID" 
                        />
                        <p className="text-xs text-gray-500 mt-1">Leave blank for default handwriting</p>
                      </div>
                      <div className="md:col-span-2">
                        <Label htmlFor="view-handwrytten-template">Message Template</Label>
                        <Textarea 
                          id="view-handwrytten-template" 
                          name="handwryttenTemplate" 
                          defaultValue={selectedAccount.settings?.handwritten?.messageTemplate || selectedAccount.settings?.handwryttenMessage || ''} 
                          placeholder="Hi {firstName}, &#10;&#10;Thank you for your interest in our services! We appreciate you visiting our website and hope to connect with you soon."
                          rows={4}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Use placeholders: {'{firstName}'}, {'{lastName}'}, {'{fullName}'}, {'{company}'}, {'{city}'}, {'{state}'}
                        </p>
                      </div>
                    </div>

                    {/* Return Address Section */}
                    <div className="mt-6 pt-4 border-t">
                      <h4 className="text-md font-medium text-gray-900 mb-3">Return Address (Optional)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="return-name">Company/Name</Label>
                          <Input 
                            id="return-name" 
                            name="returnName" 
                            defaultValue={selectedAccount.settings?.handwritten?.returnAddress?.name || ''} 
                            placeholder="Sphere DSG" 
                          />
                        </div>
                        <div>
                          <Label htmlFor="return-address1">Address Line 1</Label>
                          <Input 
                            id="return-address1" 
                            name="returnAddress1" 
                            defaultValue={selectedAccount.settings?.handwritten?.returnAddress?.address1 || ''} 
                            placeholder="456 Market St" 
                          />
                        </div>
                        <div>
                          <Label htmlFor="return-address2">Address Line 2</Label>
                          <Input 
                            id="return-address2" 
                            name="returnAddress2" 
                            defaultValue={selectedAccount.settings?.handwritten?.returnAddress?.address2 || ''} 
                            placeholder="Suite 100" 
                          />
                        </div>
                        <div>
                          <Label htmlFor="return-city">City</Label>
                          <Input 
                            id="return-city" 
                            name="returnCity" 
                            defaultValue={selectedAccount.settings?.handwritten?.returnAddress?.city || ''} 
                            placeholder="Naperville" 
                          />
                        </div>
                        <div>
                          <Label htmlFor="return-state">State</Label>
                          <Input 
                            id="return-state" 
                            name="returnState" 
                            defaultValue={selectedAccount.settings?.handwritten?.returnAddress?.state || ''} 
                            placeholder="IL" 
                          />
                        </div>
                        <div>
                          <Label htmlFor="return-zip">ZIP Code</Label>
                          <Input 
                            id="return-zip" 
                            name="returnZip" 
                            defaultValue={selectedAccount.settings?.handwritten?.returnAddress?.zip || ''} 
                            placeholder="60540" 
                          />
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Leave blank to use Handwrytten account default return address
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setViewAccountDialog(false)}>
                      Close
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={updateAccountMutation.isPending}
                    >
                      {updateAccountMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              )}
            </DialogContent>
          </Dialog>




        </TabsContent>

        {/* User Management Tab */}
        <TabsContent value="users" className="space-y-6">
          <UserManagement />
        </TabsContent>

        <TabsContent value="monitoring" className="space-y-6">
          
          {/* Sync Monitoring Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Scheduled Sync Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <Clock className="h-5 w-5 mr-2 text-blue-600" />
                  SpherePixel Scheduled Sync
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Status</span>
                    <Badge className={scheduledSyncStatus?.isRunning ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"}>
                      {scheduledSyncStatus?.status || "Scheduled"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Next Sync</span>
                    <span className="text-xs text-gray-600">
                      {scheduledSyncStatus?.nextSyncFormatted || "Calculating..."}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Last Sync</span>
                    <span className="text-xs text-gray-600">
                      {scheduledSyncStatus?.lastSyncISO ? format(new Date(scheduledSyncStatus.lastSyncISO), 'MMM d, h:mm a') : "Never"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Last Result</span>
                    <span className="text-xs text-gray-600">
                      {scheduledSyncStatus?.lastResult || "No data"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Sync Mode</span>
                    <Badge variant="outline" className="text-xs">
                      {scheduledSyncStatus?.syncMode || "Delta Sync"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Mailchimp Nightly Sync Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <Mail className="h-5 w-5 mr-2 text-yellow-600" />
                  Mailchimp Nightly Sync
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Status</span>
                    <Badge className="bg-green-100 text-green-800">
                      {mailchimpSyncStatus?.status || "Scheduled"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Next Sync</span>
                    <span className="text-xs text-gray-600">
                      {mailchimpSyncStatus?.nextSyncFormatted || "Calculating..."}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Last Sync</span>
                    <span className="text-xs text-gray-600">
                      {mailchimpSyncStatus?.lastSyncISO ? format(new Date(mailchimpSyncStatus.lastSyncISO), 'MMM d, h:mm a') : "Never"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Last Result</span>
                    <span className="text-xs text-gray-600">
                      {mailchimpSyncStatus?.lastResult || "No data"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Sync Mode</span>
                    <Badge variant="outline" className="text-xs">
                      {mailchimpSyncStatus?.syncMode || "Delta Sync"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Handwrytten Hourly Sync Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <PenTool className="h-5 w-5 mr-2 text-purple-600" />
                  Handwrytten Hourly Sync
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Status</span>
                    <Badge className="bg-green-100 text-green-800">
                      {handwryttenNightlySyncStatus?.status || "Scheduled"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Next Sync</span>
                    <span className="text-xs text-gray-600">
                      {handwryttenNightlySyncStatus?.nextSyncFormatted || "Calculating..."}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Last Sync</span>
                    <span className="text-xs text-gray-600">
                      {handwryttenNightlySyncStatus?.lastSyncISO ? format(new Date(handwryttenNightlySyncStatus.lastSyncISO), 'MMM d, h:mm a') : "Never"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Last Result</span>
                    <span className="text-xs text-gray-600">
                      {handwryttenNightlySyncStatus?.lastResult || "No data"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Sync Mode</span>
                    <Badge variant="outline" className="text-xs">
                      {handwryttenNightlySyncStatus?.syncMode || "Delta Sync"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* System Health & API Integrations - Full Width */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">System Health & API Integrations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div>
                  {/* System Health Section */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                      <Activity className="h-4 w-4 mr-2 text-green-600" />
                      System Status
                    </h4>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Server Status</span>
                      <Badge className="bg-green-100 text-green-800">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Online
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Database</span>
                      <Badge className="bg-green-100 text-green-800">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Connected
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Authentication</span>
                      <Badge className="bg-green-100 text-green-800">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Active
                      </Badge>
                    </div>
                  </div>
                </div>

                <div>
                  {/* API Integrations Section */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                      <Globe className="h-4 w-4 mr-2 text-blue-600" />
                      API Integrations
                    </h4>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Audience Acuity</span>
                      {(systemHealth as any)?.integrations?.audienceAcuity?.connected ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Disconnected
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Mailchimp</span>
                      {(systemHealth as any)?.integrations?.mailchimp?.connected ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Disconnected
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Sphere Data</span>
                      {(systemHealth as any)?.integrations?.sphereData?.connected ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          {(systemHealth as any)?.integrations?.sphereData?.error || "Disconnected"}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Handwrytten</span>
                      {(systemHealth as any)?.integrations?.handwrytten?.connected ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                      ) : (systemHealth as any)?.integrations?.handwrytten?.configured ? (
                        <Badge className="bg-yellow-100 text-yellow-800">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          API Error
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-800">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Not Configured
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* System Activity Logs */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <div className="flex items-center">
                  <Terminal className="h-5 w-5 mr-2 text-gray-600" />
                  System Activity Logs
                </div>
                <div className="flex items-center space-x-2">
                  <Button size="sm" variant="outline" onClick={() => refetchSystemLogs()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              </CardTitle>
              <div className="text-sm text-gray-600">
                Comprehensive system activity monitoring with timestamps, event types, and detailed messages
              </div>
            </CardHeader>
            <CardContent>
              {/* Filter Controls */}
              <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Filter className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700">Filters:</span>
                </div>
                
                <Select value={systemLogsFilter.eventType} onValueChange={(value) => setSystemLogsFilter(prev => ({ ...prev, eventType: value }))}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Event Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="INFO">INFO</SelectItem>
                    <SelectItem value="WARNING">WARNING</SelectItem>
                    <SelectItem value="ERROR">ERROR</SelectItem>
                    <SelectItem value="CRITICAL">CRITICAL</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={systemLogsFilter.source} onValueChange={(value) => setSystemLogsFilter(prev => ({ ...prev, source: value }))}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Source/Process" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="auth-service">Authentication</SelectItem>
                    <SelectItem value="sync-service">Sync Service</SelectItem>
                    <SelectItem value="enrichment-service">Enrichment</SelectItem>
                    <SelectItem value="handwrytten-service">Handwrytten</SelectItem>
                    <SelectItem value="mailchimp-service">Mailchimp</SelectItem>
                    <SelectItem value="system-monitor">System Monitor</SelectItem>
                    <SelectItem value="database-service">Database</SelectItem>
                    <SelectItem value="storage-service">Storage</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={systemLogsFilter.limit.toString()} onValueChange={(value) => setSystemLogsFilter(prev => ({ ...prev, limit: parseInt(value) }))}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                  </SelectContent>
                </Select>

                <Button variant="outline" size="sm" onClick={() => setSystemLogsFilter({ eventType: 'all', source: 'all', limit: 50 })}>
                  Clear Filters
                </Button>
              </div>

              {/* System Logs Table */}
              {systemLogsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  Loading system logs...
                </div>
              ) : systemLogs.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-96">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left p-3 font-medium text-gray-900 w-40">Timestamp</th>
                          <th className="text-left p-3 font-medium text-gray-900 w-24">Severity</th>
                          <th className="text-left p-3 font-medium text-gray-900 w-36">Source/Process</th>
                          <th className="text-left p-3 font-medium text-gray-900 w-24">Process ID</th>
                          <th className="text-left p-3 font-medium text-gray-900 w-24">Event Code</th>
                          <th className="text-left p-3 font-medium text-gray-900">Message</th>
                          <th className="text-left p-3 font-medium text-gray-900 w-20">Account</th>
                        </tr>
                      </thead>
                      <tbody>
                        {systemLogs.map((log: any, index: number) => {
                          const getSeverityBadge = (eventType: string) => {
                            switch (eventType) {
                              case 'INFO':
                                return <Badge className="bg-blue-100 text-blue-800 text-xs"><CheckCircle className="h-3 w-3 mr-1" />INFO</Badge>;
                              case 'WARNING':
                                return <Badge className="bg-yellow-100 text-yellow-800 text-xs"><AlertCircle className="h-3 w-3 mr-1" />WARNING</Badge>;
                              case 'ERROR':
                                return <Badge className="bg-red-100 text-red-800 text-xs"><AlertCircle className="h-3 w-3 mr-1" />ERROR</Badge>;
                              case 'CRITICAL':
                                return <Badge className="bg-red-200 text-red-900 text-xs font-bold"><AlertCircle className="h-3 w-3 mr-1" />CRITICAL</Badge>;
                              default:
                                return <Badge variant="outline" className="text-xs">{eventType}</Badge>;
                            }
                          };

                          return (
                            <tr key={log.id || index} className="border-t hover:bg-gray-50">
                              <td className="p-3 text-xs text-gray-600 font-mono">
                                {format(new Date(log.timestamp), 'MMM d, HH:mm:ss')}
                              </td>
                              <td className="p-3">
                                {getSeverityBadge(log.eventType)}
                              </td>
                              <td className="p-3 text-xs">
                                <div className="font-medium text-gray-900">{log.source}</div>
                              </td>
                              <td className="p-3 text-xs text-gray-600 font-mono">
                                {log.processId || 'N/A'}
                              </td>
                              <td className="p-3 text-xs text-gray-600 font-mono">
                                {log.eventCode || 'N/A'}
                              </td>
                              <td className="p-3 text-sm max-w-lg">
                                <div className="text-gray-900 break-words">
                                  {log.message && log.message.length > 150 ? (
                                    <>
                                      <span>{log.message.slice(0, 150)}</span>
                                      <span className="text-gray-500">...</span>
                                    </>
                                  ) : (
                                    log.message
                                  )}
                                </div>
                                {log.details && (
                                  <div className="text-xs text-gray-500 mt-1 font-mono break-words">
                                    {typeof log.details === 'string' ? (
                                      log.details.length > 100 ? log.details.slice(0, 100) + '...' : log.details
                                    ) : (
                                      JSON.stringify(log.details, null, 2).slice(0, 100)
                                    )}
                                    {(typeof log.details === 'string' ? log.details.length : JSON.stringify(log.details).length) > 100 && '...'}
                                  </div>
                                )}
                              </td>
                              <td className="p-3 text-xs">
                                {log.cid ? (
                                  <Badge variant="outline" className="text-xs">{log.cid}</Badge>
                                ) : (
                                  <span className="text-gray-400">System</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Terminal className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-lg text-gray-600 mb-2">No system logs found</p>
                  <p className="text-sm text-gray-500">
                    System activity logs will appear here as events occur
                    {(systemLogsFilter.eventType !== 'all' || systemLogsFilter.source !== 'all') ? ' with the current filters applied' : ''}
                  </p>
                </div>
              )}

              {systemLogs.length > 0 && (
                <div className="mt-4 flex justify-between items-center text-xs text-gray-500">
                  <div>
                    Showing {systemLogs.length} of {systemLogsFilter.limit} log entries
                    {systemLogsFilter.eventType && systemLogsFilter.eventType !== 'all' && ` • Filtered by: ${systemLogsFilter.eventType}`}
                    {systemLogsFilter.source && systemLogsFilter.source !== 'all' && ` • Source: ${systemLogsFilter.source}`}
                  </div>
                  <div className="text-xs text-gray-400">
                    Auto-refreshes every 10 seconds
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Search, Mail, MapPin, Phone, DollarSign, Calendar } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EnrichmentData {
  contact_email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  phone?: string;
  age?: number;
  income?: number;
  confidence_score?: number;
  data_sources?: string[];
}

interface EnrichmentResult {
  success: boolean;
  hashedEmail: string;
  enrichmentData: EnrichmentData;
  timestamp: string;
}

export default function EmailEnrichment() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const { toast } = useToast();

  const enrichMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await fetch("/api/enrich-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    },
    onSuccess: (data: EnrichmentResult) => {
      setResult(data);
      toast({
        title: "Email Enriched",
        description: "Successfully retrieved identity data from Audience Acuity",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Enrichment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEnrich = () => {
    if (!email.trim()) {
      toast({
        title: "Email Required",
        description: "Please enter an email address to enrich",
        variant: "destructive",
      });
      return;
    }

    enrichMutation.mutate(email);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Email Enrichment Tool
          </CardTitle>
          <CardDescription>
            Query Audience Acuity to enrich email addresses with identity data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter email address..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleEnrich()}
            />
            <Button onClick={handleEnrich} disabled={enrichMutation.isPending}>
              {enrichMutation.isPending ? "Enriching..." : "Enrich Email"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Enrichment Results
            </CardTitle>
            <CardDescription>
              Data retrieved from Audience Acuity API
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline">Hashed Email</Badge>
              <span className="text-sm font-mono">{result.hashedEmail}</span>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {result.enrichmentData.contact_email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Contact Email</span>
                  <Badge variant="secondary">{result.enrichmentData.contact_email}</Badge>
                </div>
              )}

              {result.enrichmentData.address && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Address</span>
                  <Badge variant="secondary">
                    {result.enrichmentData.address.city}, {result.enrichmentData.address.state}
                  </Badge>
                </div>
              )}

              {result.enrichmentData.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Phone</span>
                  <Badge variant="secondary">{result.enrichmentData.phone}</Badge>
                </div>
              )}

              {result.enrichmentData.age && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Age</span>
                  <Badge variant="secondary">{result.enrichmentData.age}</Badge>
                </div>
              )}

              {result.enrichmentData.income && (
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Income</span>
                  <Badge variant="secondary">${result.enrichmentData.income?.toLocaleString()}</Badge>
                </div>
              )}

              {result.enrichmentData.confidence_score && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">Confidence</span>
                  <Badge variant={result.enrichmentData.confidence_score > 0.8 ? "default" : "outline"}>
                    {Math.round(result.enrichmentData.confidence_score * 100)}%
                  </Badge>
                </div>
              )}
            </div>

            {result.enrichmentData.data_sources && (
              <div>
                <span className="text-sm font-medium">Data Sources:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {result.enrichmentData.data_sources.map((source, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {source}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Enriched at: {new Date(result.timestamp).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
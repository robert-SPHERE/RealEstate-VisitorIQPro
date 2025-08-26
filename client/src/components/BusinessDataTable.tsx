import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Download, Search, Filter } from "lucide-react";
import { BUSINESS_TYPE_FIELDS } from "@shared/schema";
import type { RealEstateEnrichmentData } from "@shared/schema";

interface BusinessDataTableProps {
  cid?: string;
}

export default function BusinessDataTable({ cid }: BusinessDataTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [visibleFields, setVisibleFields] = useState<string[]>(
    BUSINESS_TYPE_FIELDS.real_estate.slice(0, 8).map(field => field.key)
  );

  const { data: businessData, isLoading } = useQuery<RealEstateEnrichmentData[]>({
    queryKey: ['/api/business-data-export', cid],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (cid) {
        params.append('cid', cid);
      }
      
      const res = await fetch(`/api/business-data-export?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
  });

  const fields = BUSINESS_TYPE_FIELDS.real_estate;
  
  // Filter data based on search term
  const filteredData = businessData?.filter(row => {
    const searchLower = searchTerm.toLowerCase();
    return Object.values(row).some(value => 
      value?.toString().toLowerCase().includes(searchLower)
    );
  }) || [];

  const exportToCSV = () => {
    if (!businessData || businessData.length === 0) return;
    
    const headers = fields.filter(field => visibleFields.includes(field.key)).map(field => field.label);
    const csvContent = [
      headers.join(','),
      ...filteredData.map(row =>
        fields
          .filter(field => visibleFields.includes(field.key))
          .map(field => {
            const value = row[field.key as keyof RealEstateEnrichmentData];
            return `"${value || ''}"`;
          })
          .join(',')
      )
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `real_estate_data_export.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
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
  const formatUrl = (url: string, maxLength: number = 35): { display: string; full: string } => {
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
        const formatted = formatUrl(value, 30);
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
          <span className="break-all text-sm">{formatted.display}</span>
        );
      default:
        return value;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Business Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-500">Loading business data...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">

          {/* Data Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {fields.filter(field => visibleFields.includes(field.key)).map((field) => (
                    <TableHead key={field.key} className="font-medium">
                      {field.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleFields.length} className="text-center py-8 text-gray-500">
                      No enriched data available
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((row, index) => (
                    <TableRow key={index}>
                      {fields.filter(field => visibleFields.includes(field.key)).map((field) => (
                        <TableCell key={field.key} className="py-2">
                          {formatValue(field.key, row[field.key as keyof RealEstateEnrichmentData])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
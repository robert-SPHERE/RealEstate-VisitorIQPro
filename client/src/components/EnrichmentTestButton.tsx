import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/queryClient';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface EnrichmentTestResult {
  timestamp: string;
  apiCredentials: {
    keyIdPresent: boolean;
    keyIdPrefix: string;
    apiKeyPresent: boolean;
    apiKeyLength: number;
  };
  directApiTest: {
    success: boolean;
    dataFound?: boolean;
    resultType?: string;
    resultCount?: number;
    sampleData?: string;
    error?: string;
    errorType?: string;
  } | null;
  batchTest: {
    success: boolean;
    recordsProcessed?: number;
    enriched?: number;
    failed?: number;
    skipped?: number;
    retried?: number;
    errorCount?: number;
    errors?: Array<{ id: number; md5: string; error: string; retryCount: number }>;
    message?: string;
    error?: string;
    errorType?: string;
  } | null;
  errors: string[];
}

export function EnrichmentTestButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<EnrichmentTestResult | null>(null);

  const runTest = async () => {
    setTesting(true);
    try {
      const response = await apiRequest('/api/admin/test-enrichment-system', 'POST', {
        testMd5: '2cb51ec6815a4ab98a81f65be5155631',
        batchSize: 5
      });
      setResult(response as EnrichmentTestResult);
    } catch (error: any) {
      console.error('Enrichment test failed:', error);
      setResult({
        timestamp: new Date().toISOString(),
        apiCredentials: { keyIdPresent: false, keyIdPrefix: 'error', apiKeyPresent: false, apiKeyLength: 0 },
        directApiTest: { success: false, error: error?.message || 'Test request failed' },
        batchTest: null,
        errors: [error?.message || 'Test request failed']
      });
    } finally {
      setTesting(false);
    }
  };

  const getStatusIcon = (success: boolean | undefined) => {
    if (success === true) return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (success === false) return <XCircle className="w-4 h-4 text-red-500" />;
    return <AlertCircle className="w-4 h-4 text-yellow-500" />;
  };

  const getStatusBadge = (success: boolean | undefined) => {
    if (success === true) return <Badge variant="default" className="bg-green-100 text-green-800">Success</Badge>;
    if (success === false) return <Badge variant="destructive">Failed</Badge>;
    return <Badge variant="secondary">Unknown</Badge>;
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Play className="w-4 h-4 mr-2" />
          Test Enrichment System
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enrichment System Test</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Test the enhanced enrichment system with retry logic, batch processing, and comprehensive monitoring.
            </p>
            <Button 
              onClick={runTest} 
              disabled={testing}
              className="ml-4"
            >
              {testing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Run Test
                </>
              )}
            </Button>
          </div>

          {result && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500">
                Test completed at: {new Date(result.timestamp).toLocaleString()}
              </div>

              {/* API Credentials */}
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold mb-2 flex items-center">
                  {getStatusIcon(result.apiCredentials.keyIdPresent && result.apiCredentials.apiKeyPresent)}
                  <span className="ml-2">API Credentials</span>
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>Key ID Present: {result.apiCredentials.keyIdPresent ? '✅ Yes' : '❌ No'}</div>
                  <div>Key ID Prefix: {result.apiCredentials.keyIdPrefix}</div>
                  <div>API Key Present: {result.apiCredentials.apiKeyPresent ? '✅ Yes' : '❌ No'}</div>
                  <div>API Key Length: {result.apiCredentials.apiKeyLength} chars</div>
                </div>
              </div>

              {/* Direct API Test */}
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold mb-2 flex items-center justify-between">
                  <span className="flex items-center">
                    {getStatusIcon(result.directApiTest?.success)}
                    <span className="ml-2">Direct API Test</span>
                  </span>
                  {getStatusBadge(result.directApiTest?.success)}
                </h3>
                {result.directApiTest ? (
                  <div className="space-y-2 text-sm">
                    {result.directApiTest.success ? (
                      <div className="space-y-1">
                        <div>Data Found: {result.directApiTest.dataFound ? '✅ Yes' : '❌ No'}</div>
                        <div>Result Type: {result.directApiTest.resultType}</div>
                        <div>Result Count: {result.directApiTest.resultCount}</div>
                        {result.directApiTest.sampleData && (
                          <div className="bg-gray-50 p-2 rounded mt-2">
                            <div className="font-medium">Sample Data:</div>
                            <code className="text-xs">{result.directApiTest.sampleData}</code>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="text-red-600">Error: {result.directApiTest.error}</div>
                        <div className="text-red-500">Type: {result.directApiTest.errorType}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-500">Not tested</div>
                )}
              </div>

              {/* Batch Test */}
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold mb-2 flex items-center justify-between">
                  <span className="flex items-center">
                    {getStatusIcon(result.batchTest?.success)}
                    <span className="ml-2">Batch Enrichment Test</span>
                  </span>
                  {getStatusBadge(result.batchTest?.success)}
                </h3>
                {result.batchTest ? (
                  <div className="space-y-2 text-sm">
                    {result.batchTest.success ? (
                      <div className="space-y-1">
                        {result.batchTest.message ? (
                          <div>{result.batchTest.message}</div>
                        ) : (
                          <div className="grid grid-cols-2 gap-4">
                            <div>Records Processed: {result.batchTest.recordsProcessed}</div>
                            <div>Enriched: {result.batchTest.enriched}</div>
                            <div>Failed: {result.batchTest.failed}</div>
                            <div>Skipped: {result.batchTest.skipped}</div>
                            <div>Retried: {result.batchTest.retried}</div>
                            <div>Errors: {result.batchTest.errorCount}</div>
                          </div>
                        )}
                        {result.batchTest.errors && result.batchTest.errors.length > 0 && (
                          <div className="bg-red-50 p-2 rounded mt-2">
                            <div className="font-medium text-red-800">Recent Errors:</div>
                            {result.batchTest.errors.map((error, i) => (
                              <div key={i} className="text-xs text-red-600">
                                MD5: {error.md5}... - {error.error}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="text-red-600">Error: {result.batchTest.error}</div>
                        <div className="text-red-500">Type: {result.batchTest.errorType}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-500">Not tested</div>
                )}
              </div>

              {/* Overall Errors */}
              {result.errors.length > 0 && (
                <div className="border border-red-200 rounded-lg p-4 bg-red-50">
                  <h3 className="font-semibold mb-2 text-red-800">System Errors</h3>
                  <div className="space-y-1">
                    {result.errors.map((error, i) => (
                      <div key={i} className="text-sm text-red-600">• {error}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
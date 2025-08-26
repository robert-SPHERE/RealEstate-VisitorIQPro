import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import TopNavigation from "@/components/TopNavigation";
import AdminDashboard from "@/components/AdminDashboard";
import ClientDashboard from "@/components/ClientDashboard";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [currentView, setCurrentView] = useState<'admin' | 'client'>('admin');
  const [selectedCid, setSelectedCid] = useState<string>("all");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/auth";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  // Set default view based on user role
  useEffect(() => {
    if (user?.role) {
      setCurrentView(user.role === 'admin' ? 'admin' : 'client');
    }
  }, [user]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNavigation 
        user={user} 
        currentView={currentView} 
        onViewChange={setCurrentView}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === 'admin' ? (
          <AdminDashboard user={user} selectedCid={selectedCid} onCidChange={setSelectedCid} />
        ) : (
          <ClientDashboard user={user} selectedCid={selectedCid} />
        )}
      </div>
    </div>
  );
}

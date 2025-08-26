import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Home, User, Shield, Building, ChevronDown, LogOut, Settings, Presentation } from "lucide-react";
import type { User as UserType } from "@shared/schema";
import AccountSettings from "./AccountSettings";
import logoPath from "@assets/VisitorIQ Pro High Res Logo - No Background_1753562672621.png";

interface TopNavigationProps {
  user: UserType;
  currentView: 'admin' | 'client';
  onViewChange: (view: 'admin' | 'client') => void;
}

export default function TopNavigation({ user, currentView, onViewChange }: TopNavigationProps) {
  const handleLogout = async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
      window.location.href = "/auth";
    } catch (error) {
      console.error("Logout failed:", error);
      // Still redirect to auth page even if logout fails
      window.location.href = "/auth";
    }
  };

  const userInitials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` || user.email?.[0]?.toUpperCase() || 'U';
  const userName = user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email;

  return (
    <nav className="bg-gradient-to-r from-slate-600 via-slate-500 to-blue-600 shadow-sm border-b border-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <img 
              src={logoPath} 
              alt="VisitorIQ Pro" 
              className="h-36 w-auto"
            />
          </div>

          {/* Center - Admin Role Badge and View Switcher */}
          {user.role === 'admin' && (
            <div className="flex items-center space-x-4">
              {/* Role Badge - Admin Only */}
              <Badge 
                variant="default"
                className="bg-red-100 text-red-800 border-red-200 px-3 py-1"
              >
                <Shield className="h-3 w-3 mr-1" />
                Administrator
              </Badge>

              {/* View Switcher - Admin Only */}
              <div className="flex bg-gray-50 rounded-lg p-1 border">
                <Button
                  variant={currentView === 'admin' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => onViewChange('admin')}
                  className="transition-all duration-200 text-xs"
                >
                  <Shield className="h-3 w-3 mr-1" />
                  All Accounts
                </Button>
                <Button
                  variant={currentView === 'client' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => onViewChange('client')}
                  className="transition-all duration-200 text-xs"
                >
                  <Building className="h-3 w-3 mr-1" />
                  Client View
                </Button>
              </div>
            </div>
          )}

          {/* Right - User Profile */}
          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center space-x-2 h-10 px-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.profileImageUrl || ""} alt={userName} />
                    <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-500 text-white text-sm font-medium">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-left hidden md:block">
                    <p className="text-sm font-medium text-white">{userName}</p>
                    <p className="text-xs text-white opacity-90">{user.email}</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem disabled className="flex-col items-start">
                  <div className="font-medium">{userName}</div>
                  <div className="text-xs text-gray-500">{user.email}</div>
                  <Badge variant="outline" className="mt-1 text-xs">
                    {user.role === 'admin' ? 'Administrator' : 'Client Access'}
                  </Badge>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <AccountSettings />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600 focus:text-red-600">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </nav>
  );
}

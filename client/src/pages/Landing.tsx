import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Lock, Eye, Lightbulb, Zap, Users, TrendingUp, Target } from "lucide-react";
import visitorIqLogo from "@assets/VisitorIQ Pro High Res Logo - No Background_1753562672621.png";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = "/auth";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Top colored strip with logo */}
      <div className="bg-gradient-to-r from-slate-600 via-slate-500 to-blue-600" style={{ paddingTop: '2px', paddingBottom: '2px' }}>
        <div className="text-center">
          <img 
            src={visitorIqLogo} 
            alt="VisitorIQ Pro" 
            className="h-48 w-auto mx-auto"
          />
        </div>
      </div>

      <div className="flex justify-center px-4" style={{ marginTop: '50px' }}>
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-8 w-full max-w-2xl">
          {/* Main Header */}
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">
              Get Ready To...
            </h2>
          </div>

          {/* Feature List */}
          <div className="space-y-6 mb-8">
            <div className="flex items-start space-x-4">
              <div className="bg-blue-600 p-2 rounded-full flex-shrink-0 mt-0.5">
                <Eye className="h-5 w-5 text-white" />
              </div>
              <span className="text-gray-800 font-medium text-lg leading-relaxed">Understand who is coming to your website</span>
            </div>
            <div className="flex items-start space-x-4">
              <div className="bg-green-600 p-2 rounded-full flex-shrink-0 mt-0.5">
                <Lightbulb className="h-5 w-5 text-white" />
              </div>
              <span className="text-gray-800 font-medium text-lg leading-relaxed">Uncover key insights about each visitor—so you're prepared for more informed conversations</span>
            </div>
            <div className="flex items-start space-x-4">
              <div className="bg-purple-600 p-2 rounded-full flex-shrink-0 mt-0.5">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <span className="text-gray-800 font-medium text-lg leading-relaxed">Automate your marketing—so you can focus on selling</span>
            </div>
          </div>

          {/* Sign In Button */}
          <div className="flex justify-center">
            <Button 
              onClick={handleLogin} 
              className="w-80 bg-blue-600 hover:bg-blue-700 text-white py-3 mb-6 text-lg font-semibold" 
              size="lg"
            >
              Sign In
            </Button>
          </div>

          {/* Footer Info */}
          <div className="text-center space-y-3">
            <p className="text-sm text-gray-600">
              Secure login. Need help?{" "}
              <a href="mailto:support@visitoriqpro.com" className="text-blue-600 hover:text-blue-700 font-medium">
                Contact Support
              </a>
            </p>
            <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
              <Lock className="h-4 w-4" />
              <span>Your data is protected with enterprise-grade security.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Redirect } from "wouter";
import logoPath from "@assets/VisitorIQ Pro High Res Logo - No Background_1753562672621.png";

// Validation schemas
const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type LoginForm = z.infer<typeof loginSchema>;
type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export default function AuthPage() {
  // All hooks must be called at the top level
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState("");
  const { toast } = useToast();
  const { user, isLoading } = useAuth();

  // All form hooks
  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const forgotPasswordForm = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  // All mutation hooks
  const loginMutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      const response = await apiRequest("POST", "/api/login", data);
      return response.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/user"], user);
      toast({ title: "Welcome back!", description: "You have successfully logged in." });
    },
    onError: (error: any) => {
      toast({
        title: "Login failed",
        description: error.message || "Invalid username or password",
        variant: "destructive",
      });
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async (data: ForgotPasswordForm) => {
      const response = await apiRequest("POST", "/api/forgot-password", data);
      return response.json();
    },
    onSuccess: (data) => {
      setForgotPasswordMessage(data.message);
      forgotPasswordForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send reset link",
        variant: "destructive",
      });
    },
  });

  // Event handlers
  const onLogin = (data: LoginForm) => {
    loginMutation.mutate(data);
  };

  const onForgotPassword = (data: ForgotPasswordForm) => {
    forgotPasswordMutation.mutate(data);
  };

  // Conditional renders after all hooks
  if (!isLoading && user) {
    return <Redirect to="/" />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Top colored strip with logo - matching home page exactly */}
      <div className="bg-gradient-to-r from-slate-600 via-slate-500 to-blue-600" style={{ paddingTop: '2px', paddingBottom: '2px' }}>
        <div className="text-center">
          <img 
            src={logoPath} 
            alt="VisitorIQ Pro" 
            className="h-48 w-auto mx-auto"
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex items-center justify-center px-4" style={{ marginTop: '50px' }}>
        <Card className="w-full max-w-md mx-auto">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-2xl font-bold text-gray-900">Welcome</CardTitle>
            <CardDescription className="text-gray-600">
              Sign in to your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            {showForgotPassword ? (
              <div className="space-y-4">
                <div className="text-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Reset Your Password</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Enter your email address and we'll send you a reset link
                  </p>
                </div>

                {forgotPasswordMessage && (
                  <Alert className="mb-4">
                    <AlertDescription>{forgotPasswordMessage}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={forgotPasswordForm.handleSubmit(onForgotPassword)} className="space-y-4">
                  <div>
                    <Label htmlFor="reset-email">Email Address</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder="Enter your email"
                      {...forgotPasswordForm.register("email")}
                    />
                    {forgotPasswordForm.formState.errors.email && (
                      <p className="text-sm text-red-600 mt-1">
                        {forgotPasswordForm.formState.errors.email.message}
                      </p>
                    )}
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full"
                    disabled={forgotPasswordMutation.isPending}
                  >
                    {forgotPasswordMutation.isPending ? "Sending..." : "Send Reset Link"}
                  </Button>
                </form>

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setForgotPasswordMessage("");
                  }}
                >
                  Back to Login
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                  <div>
                    <Label htmlFor="username">Username or Email</Label>
                    <Input
                      id="username"
                      placeholder="Enter your username or email"
                      {...loginForm.register("username")}
                    />
                    {loginForm.formState.errors.username && (
                      <p className="text-sm text-red-600 mt-1">
                        {loginForm.formState.errors.username.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      {...loginForm.register("password")}
                    />
                    {loginForm.formState.errors.password && (
                      <p className="text-sm text-red-600 mt-1">
                        {loginForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full"
                    disabled={loginMutation.isPending}
                  >
                    {loginMutation.isPending ? "Signing In..." : "Sign In"}
                  </Button>
                </form>

                <div className="text-center">
                  <Button
                    variant="link"
                    className="text-sm text-blue-600 hover:text-blue-800"
                    onClick={() => setShowForgotPassword(true)}
                  >
                    Forgot your password?
                  </Button>
                </div>

                <div className="text-center mt-6 pt-4 border-t border-gray-200">
                  <p className="text-sm text-gray-500">
                    Need an account? Contact your administrator.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
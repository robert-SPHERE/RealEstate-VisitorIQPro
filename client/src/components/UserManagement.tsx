import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { UserPlus, Users, Key, Settings, Shield, Copy, CheckCircle, Edit, Trash2 } from 'lucide-react';

interface CreateUserForm {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  role: 'admin' | 'client';
  assignedCid: string;
  sendInvitation: boolean;
}

interface EditUserForm {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'client';
  assignedCid: string;
  // Account linking fields
  updateLinkedAccount: boolean;
  accountName: string;
  accountFirstName: string;
  accountLastName: string;
  accountEmail: string;
  accountWebsite: string;
}

interface UserLoginResult {
  user: any;
  loginInstructions: string;
  accessDetails: string;
  temporaryPassword: string;
}

export function UserManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [showLoginInstructions, setShowLoginInstructions] = useState(false);
  const [lastGeneratedLogin, setLastGeneratedLogin] = useState<UserLoginResult | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<any>(null);

  const [createForm, setCreateForm] = useState<CreateUserForm>({
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    role: 'client',
    assignedCid: '',
    sendInvitation: false
  });

  const [editForm, setEditForm] = useState<EditUserForm>({
    id: 0,
    email: '',
    firstName: '',
    lastName: '',
    role: 'client',
    assignedCid: '',
    updateLinkedAccount: false,
    accountName: '',
    accountFirstName: '',
    accountLastName: '',
    accountEmail: '',
    accountWebsite: ''
  });

  // Get CID accounts for assignment
  const { data: cidAccounts } = useQuery({
    queryKey: ['/api/cid-accounts'],
  });

  // Get existing users
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['/api/admin/users'],
  });

  // Generate user login mutation
  const generateLoginMutation = useMutation({
    mutationFn: async (userData: CreateUserForm) => {
      const result = await apiRequest('POST', '/api/admin/users/generate-login', userData);
      return await result.json();
    },
    onSuccess: (data) => {
      setLastGeneratedLogin(data);
      setShowLoginInstructions(true);
      setIsCreateDialogOpen(false);
      
      toast({
        title: "User Login Generated",
        description: `Login created for ${data.user.firstName} ${data.user.lastName}`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      
      // Reset form
      setCreateForm({
        email: '',
        firstName: '',
        lastName: '',
        password: '',
        role: 'client',
        assignedCid: '',
        sendInvitation: false
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate user login",
        variant: "destructive",
      });
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async (userData: EditUserForm) => {
      const result = await apiRequest('PUT', `/api/admin/users/${userData.id}`, userData);
      return await result.json();
    },
    onSuccess: (data) => {
      setIsEditDialogOpen(false);
      setEditingUser(null);
      
      toast({
        title: "User Updated",
        description: `Profile updated for ${data.firstName} ${data.lastName}`,
      });
      
      // Invalidate both users and accounts queries since we might have updated linked account
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cid-accounts'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user profile",
        variant: "destructive",
      });
    },
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const result = await apiRequest('DELETE', `/api/admin/users/${userId}`);
      return await result.json();
    },
    onSuccess: (data) => {
      setIsEditDialogOpen(false);
      setEditingUser(null);
      
      toast({
        title: "User Deleted",
        description: `User account has been permanently deleted`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      toast({
        title: "Copied",
        description: `${fieldName} copied to clipboard`,
      });
      
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleCreateUser = () => {
    if (!createForm.email || !createForm.firstName || !createForm.lastName || !createForm.password) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields including password",
        variant: "destructive",
      });
      return;
    }

    if (createForm.password.length < 8) {
      toast({
        title: "Validation Error",
        description: "Password must be at least 8 characters long",
        variant: "destructive",
      });
      return;
    }

    if (createForm.role === 'client' && !createForm.assignedCid) {
      toast({
        title: "Validation Error", 
        description: "Client users must have an assigned CID account",
        variant: "destructive",
      });
      return;
    }

    generateLoginMutation.mutate(createForm);
  };

  const handleEditUser = (user: any) => {
    setEditingUser(user);
    const linkedAccount = Array.isArray(cidAccounts) ? cidAccounts.find((account: any) => account.cid === user.assignedCid) : null;
    
    setEditForm({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      assignedCid: user.assignedCid || '',
      updateLinkedAccount: false,
      accountName: linkedAccount?.accountName || '',
      accountFirstName: linkedAccount?.firstName || '',
      accountLastName: linkedAccount?.lastName || '',
      accountEmail: linkedAccount?.email || '',
      accountWebsite: linkedAccount?.website || ''
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateUser = () => {
    if (!editForm.email || !editForm.firstName || !editForm.lastName) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    if (editForm.role === 'client' && !editForm.assignedCid) {
      toast({
        title: "Validation Error", 
        description: "Client users must have an assigned CID account",
        variant: "destructive",
      });
      return;
    }

    updateUserMutation.mutate(editForm);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">User Management</h2>
          <p className="text-gray-600 dark:text-gray-400">Generate logins and manage platform access</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Generate User Login
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Generate New User Login</DialogTitle>
              <DialogDescription>
                Create a new user account with appropriate access permissions
              </DialogDescription>
            </DialogHeader>
            
            <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={createForm.firstName}
                    onChange={(e) => setCreateForm({...createForm, firstName: e.target.value})}
                    placeholder="Enter first name"
                  />
                </div>
                <div>
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={createForm.lastName}
                    onChange={(e) => setCreateForm({...createForm, lastName: e.target.value})}
                    placeholder="Enter last name"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({...createForm, email: e.target.value})}
                  placeholder="Enter email address"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({...createForm, password: e.target.value})}
                  placeholder="Enter secure password (min 8 characters)"
                  autoComplete="new-password"
                />
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Password will be used for user login - ensure it's secure
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="role">User Role *</Label>
                  <Select 
                    value={createForm.role} 
                    onValueChange={(value: 'admin' | 'client') => setCreateForm({...createForm, role: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Administrator</SelectItem>
                      <SelectItem value="client">Client User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {createForm.role === 'client' && (
                  <div>
                    <Label htmlFor="assignedCid">Assigned Account *</Label>
                    <Select 
                      value={createForm.assignedCid}
                      onValueChange={(value) => setCreateForm({...createForm, assignedCid: value})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select CID account" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.isArray(cidAccounts) && cidAccounts.map((account: any) => (
                          <SelectItem key={account.cid} value={account.cid}>
                            {account.accountName} ({account.cid})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Access Level:</h4>
                {createForm.role === 'admin' ? (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <Shield className="h-4 w-4" />
                    Full platform administration access
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <Users className="h-4 w-4" />
                    {createForm.assignedCid 
                      ? `Client access to account: ${createForm.assignedCid}`
                      : 'Select an account to assign access'
                    }
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button 
                  type="button"
                  variant="outline" 
                  onClick={() => setIsCreateDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="button"
                  onClick={handleCreateUser}
                  disabled={generateLoginMutation.isPending}
                >
                  {generateLoginMutation.isPending ? 'Generating...' : 'Generate Login'}
                </Button>
              </div>
            </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit User Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit User Profile</DialogTitle>
            <DialogDescription>
              Update user information and access permissions
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="editFirstName">First Name *</Label>
                <Input
                  id="editFirstName"
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({...editForm, firstName: e.target.value})}
                  placeholder="Enter first name"
                />
              </div>
              <div>
                <Label htmlFor="editLastName">Last Name *</Label>
                <Input
                  id="editLastName"
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({...editForm, lastName: e.target.value})}
                  placeholder="Enter last name"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="editEmail">Email Address *</Label>
              <Input
                id="editEmail"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                placeholder="user@example.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="editRole">User Role *</Label>
                <Select 
                  value={editForm.role} 
                  onValueChange={(value: 'admin' | 'client') => setEditForm({...editForm, role: value})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrator</SelectItem>
                    <SelectItem value="client">Client User</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editForm.role === 'client' && (
                <div>
                  <Label htmlFor="editAssignedCid">Assigned Account *</Label>
                  <Select 
                    value={editForm.assignedCid}
                    onValueChange={(value) => setEditForm({...editForm, assignedCid: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select CID account" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.isArray(cidAccounts) && cidAccounts.map((account: any) => (
                        <SelectItem key={account.cid} value={account.cid}>
                          {account.accountName} ({account.cid})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Account Details Editing */}
            {editForm.role === 'client' && editForm.assignedCid && (
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Linked Account Details:</h4>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="updateLinkedAccount"
                      checked={editForm.updateLinkedAccount}
                      onChange={(e) => setEditForm({...editForm, updateLinkedAccount: e.target.checked})}
                      className="rounded"
                    />
                    <Label htmlFor="updateLinkedAccount" className="text-sm">
                      Edit Account Details
                    </Label>
                  </div>
                </div>
                
                {editForm.updateLinkedAccount ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="accountName">Account Name</Label>
                        <Input
                          id="accountName"
                          value={editForm.accountName}
                          onChange={(e) => setEditForm({...editForm, accountName: e.target.value})}
                          placeholder="Enter account name"
                        />
                      </div>
                      <div>
                        <Label htmlFor="assignedCidDisplay">Client ID (CID)</Label>
                        <Input
                          id="assignedCidDisplay"
                          value={editForm.assignedCid}
                          disabled
                          className="bg-gray-100 dark:bg-gray-700"
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="accountFirstName">Contact First Name</Label>
                        <Input
                          id="accountFirstName"
                          value={editForm.accountFirstName}
                          onChange={(e) => setEditForm({...editForm, accountFirstName: e.target.value})}
                          placeholder="Contact first name"
                        />
                      </div>
                      <div>
                        <Label htmlFor="accountLastName">Contact Last Name</Label>
                        <Input
                          id="accountLastName"
                          value={editForm.accountLastName}
                          onChange={(e) => setEditForm({...editForm, accountLastName: e.target.value})}
                          placeholder="Contact last name"
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="accountEmail">Contact Email</Label>
                        <Input
                          id="accountEmail"
                          type="email"
                          value={editForm.accountEmail}
                          onChange={(e) => setEditForm({...editForm, accountEmail: e.target.value})}
                          placeholder="contact@example.com"
                        />
                      </div>
                      <div>
                        <Label htmlFor="accountWebsite">Website</Label>
                        <Input
                          id="accountWebsite"
                          value={editForm.accountWebsite}
                          onChange={(e) => setEditForm({...editForm, accountWebsite: e.target.value})}
                          placeholder="www.example.com"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Account Name:</span>
                      <p className="font-medium">{editForm.accountName || 'Not set'}</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Client ID (CID):</span>
                      <p className="font-medium font-mono">{editForm.assignedCid}</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Contact Name:</span>
                      <p className="font-medium">
                        {editForm.accountFirstName || editForm.accountLastName 
                          ? `${editForm.accountFirstName} ${editForm.accountLastName}`.trim()
                          : 'Not set'
                        }
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Contact Email:</span>
                      <p className="font-medium">{editForm.accountEmail || 'Not set'}</p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-600 dark:text-gray-400">Website:</span>
                      <p className="font-medium">{editForm.accountWebsite || 'Not set'}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <h4 className="font-medium mb-2">Access Level:</h4>
              {editForm.role === 'admin' ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Shield className="h-4 w-4" />
                  Full platform administration access
                </div>
              ) : (
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                  <Users className="h-4 w-4" />
                  {editForm.assignedCid 
                    ? `Client access to account: ${editForm.assignedCid}`
                    : 'Select an account to assign access'
                  }
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <Button 
                variant="destructive" 
                onClick={() => {
                  if (confirm(`Are you sure you want to delete ${editForm.firstName} ${editForm.lastName}? This action cannot be undone.`)) {
                    deleteUserMutation.mutate(editForm.id);
                  }
                }}
                disabled={deleteUserMutation.isPending}
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {deleteUserMutation.isPending ? 'Deleting...' : 'Delete User'}
              </Button>
              
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setIsEditDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleUpdateUser}
                  disabled={updateUserMutation.isPending}
                >
                  {updateUserMutation.isPending ? 'Updating...' : 'Update Profile'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Login Instructions Dialog */}
      <Dialog open={showLoginInstructions} onOpenChange={setShowLoginInstructions}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              User Login Generated Successfully
            </DialogTitle>
            <DialogDescription>
              Login created for {lastGeneratedLogin?.user?.firstName} {lastGeneratedLogin?.user?.lastName}
            </DialogDescription>
          </DialogHeader>
          
          {lastGeneratedLogin && (
            <div className="space-y-6">
              {/* User Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">User Account Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="font-medium">Name</Label>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {lastGeneratedLogin.user.firstName} {lastGeneratedLogin.user.lastName}
                      </p>
                    </div>
                    <div>
                      <Label className="font-medium">Email</Label>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {lastGeneratedLogin.user.email}
                        </p>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => copyToClipboard(lastGeneratedLogin.user.email, 'Email')}
                        >
                          {copiedField === 'Email' ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="font-medium">Role</Label>
                      <Badge variant={lastGeneratedLogin.user.role === 'admin' ? 'default' : 'secondary'}>
                        {lastGeneratedLogin.user.role === 'admin' ? 'Administrator' : 'Client User'}
                      </Badge>
                    </div>
                    <div>
                      <Label className="font-medium">User ID</Label>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                          {lastGeneratedLogin.user.id}
                        </p>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => copyToClipboard(lastGeneratedLogin.user.id, 'User ID')}
                        >
                          {copiedField === 'User ID' ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* User Password */}
              <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2 text-blue-800 dark:text-blue-200">
                    <Shield className="h-4 w-4" />
                    User Password
                  </CardTitle>
                  <CardDescription className="text-blue-700 dark:text-blue-300">
                    Password set for this user account - share securely with the user
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                    <code className="text-lg font-mono font-bold text-blue-900 dark:text-blue-100 flex-1">
                      {lastGeneratedLogin.temporaryPassword}
                    </code>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => copyToClipboard(lastGeneratedLogin.temporaryPassword, 'User Password')}
                    >
                      {copiedField === 'User Password' ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Login Instructions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    Login Instructions
                  </CardTitle>
                  <CardDescription>Share these instructions with the new user</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative">
                    <pre className="text-sm bg-gray-50 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                      {lastGeneratedLogin.loginInstructions}
                    </pre>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="absolute top-2 right-2"
                      onClick={() => copyToClipboard(lastGeneratedLogin.loginInstructions, 'Login Instructions')}
                    >
                      {copiedField === 'Login Instructions' ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Access Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Access Details
                  </CardTitle>
                  <CardDescription>Technical access configuration</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="relative">
                    <pre className="text-sm bg-gray-50 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                      {lastGeneratedLogin.accessDetails}
                    </pre>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="absolute top-2 right-2"
                      onClick={() => copyToClipboard(lastGeneratedLogin.accessDetails, 'Access Details')}
                    >
                      {copiedField === 'Access Details' ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2">
                <Button onClick={() => setShowLoginInstructions(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Current Users */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Current Users
          </CardTitle>
          <CardDescription>
            Users with platform access
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="text-center py-4">Loading users...</div>
          ) : Array.isArray(users) && users.length > 0 ? (
            <div className="space-y-4">
              {users.map((user: any, index: number) => (
                <div key={user.id || index} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <h4 className="font-medium">
                          {user.firstName} {user.lastName}
                        </h4>
                        <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                          {user.role === 'admin' ? 'Administrator' : 'Client User'}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {user.email}
                      </p>
                      {user.assignedCid && (() => {
                        const linkedAccount = Array.isArray(cidAccounts) ? cidAccounts.find((account: any) => account.cid === user.assignedCid) : null;
                        return (
                          <div className="text-sm space-y-1">
                            <p className="text-blue-600 dark:text-blue-400">
                              Assigned to: {linkedAccount?.accountName || user.assignedCid} ({user.assignedCid})
                            </p>
                            {linkedAccount && (linkedAccount.firstName || linkedAccount.lastName) && (
                              <p className="text-gray-500 dark:text-gray-400">
                                Contact: {linkedAccount.firstName} {linkedAccount.lastName}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEditUser(user)}
                        className="flex items-center gap-1"
                      >
                        <Edit className="h-3 w-3" />
                        Edit
                      </Button>
                      <div className="text-right text-sm text-gray-500">
                        <p>Created: {new Date(user.createdAt).toLocaleDateString()}</p>
                        <p>Last Updated: {new Date(user.updatedAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No users found. Generate your first user login to get started.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
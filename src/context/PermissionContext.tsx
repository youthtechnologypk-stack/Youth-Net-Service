import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { SystemRole } from '../types/auth';
import {
  FeatureKey,
  DEFAULT_ROLE_PERMISSIONS,
  RolePermissionsState,
} from '../types/permissions';
import { getStoredUser } from '../lib/auth';

interface PermissionContextType {
  permissions: Record<SystemRole, Record<string, boolean>>;
  userOverrides: Record<string, Record<string, boolean>>;
  isLoading: boolean;
  lastSync: Date | null;
  hasPermission: (featureKey: FeatureKey, role?: SystemRole, userId?: string) => boolean;
  updateRolePermission: (role: SystemRole, featureKey: FeatureKey, enabled: boolean) => Promise<boolean>;
  batchUpdateRolePermissions: (role: SystemRole, updates: Record<string, boolean>) => Promise<boolean>;
  resetRolePermissions: (role?: SystemRole) => Promise<boolean>;
  updateUserPermissionOverride: (userId: string, featureKey: FeatureKey, enabled: boolean | null) => Promise<boolean>;
  refreshPermissions: () => Promise<void>;
}

const STORAGE_KEY = 'netpulse_role_permissions_v1';
const USER_OVERRIDES_STORAGE_KEY = 'netpulse_user_overrides_v1';

const PermissionContext = createContext<PermissionContextType | undefined>(undefined);

export const PermissionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [permissions, setPermissions] = useState<Record<SystemRole, Record<string, boolean>>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ADMIN: { ...DEFAULT_ROLE_PERMISSIONS.ADMIN, ...(parsed.ADMIN || {}) },
          MANAGER: { ...DEFAULT_ROLE_PERMISSIONS.MANAGER, ...(parsed.MANAGER || {}) },
          AGENT: { ...DEFAULT_ROLE_PERMISSIONS.AGENT, ...(parsed.AGENT || {}) },
          CLIENT: { ...DEFAULT_ROLE_PERMISSIONS.CLIENT, ...(parsed.CLIENT || {}) },
        };
      }
    } catch {
      // ignore
    }
    return DEFAULT_ROLE_PERMISSIONS;
  });

  const [userOverrides, setUserOverrides] = useState<Record<string, Record<string, boolean>>>(() => {
    try {
      const stored = localStorage.getItem(USER_OVERRIDES_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // Sync state to local storage
  const saveToLocal = (
    newPerms: Record<SystemRole, Record<string, boolean>>,
    newOverrides?: Record<string, Record<string, boolean>>
  ) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPerms));
      if (newOverrides) {
        localStorage.setItem(USER_OVERRIDES_STORAGE_KEY, JSON.stringify(newOverrides));
      }
    } catch {
      // storage unavailable
    }
  };

  // Fetch from server database
  const refreshPermissions = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/permissions');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.roles) {
          const merged: Record<SystemRole, Record<string, boolean>> = {
            ADMIN: { ...DEFAULT_ROLE_PERMISSIONS.ADMIN, ...(data.roles.ADMIN || {}) },
            MANAGER: { ...DEFAULT_ROLE_PERMISSIONS.MANAGER, ...(data.roles.MANAGER || {}) },
            AGENT: { ...DEFAULT_ROLE_PERMISSIONS.AGENT, ...(data.roles.AGENT || {}) },
            CLIENT: { ...DEFAULT_ROLE_PERMISSIONS.CLIENT, ...(data.roles.CLIENT || {}) },
          };
          setPermissions(merged);
          if (data.userOverrides) {
            setUserOverrides(data.userOverrides);
          }
          saveToLocal(merged, data.userOverrides);
          setLastSync(new Date());
        }
      }
    } catch (err) {
      console.warn('[Permissions] Failed to fetch server permissions, continuing with local cache:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPermissions();
  }, [refreshPermissions]);

  // Core Evaluation Function
  const hasPermission = useCallback(
    (featureKey: FeatureKey, role?: SystemRole, userId?: string): boolean => {
      // 1. Determine target role: passed explicitly or current user's role
      const currentUser = getStoredUser();
      const targetRole: SystemRole = role || currentUser?.role || 'ADMIN';
      const targetUserId: string | undefined = userId || currentUser?.id;

      // Master Admin always has full access
      if (targetRole === 'ADMIN') {
        return true;
      }

      // 2. Check user-level override first if present
      if (targetUserId && userOverrides[targetUserId] && typeof userOverrides[targetUserId][featureKey] === 'boolean') {
        return userOverrides[targetUserId][featureKey];
      }

      // 3. Check role-level setting
      const roleMap = permissions[targetRole];
      if (roleMap && typeof roleMap[featureKey] === 'boolean') {
        return roleMap[featureKey];
      }

      // 4. Fallback to system default
      const defaultMap = DEFAULT_ROLE_PERMISSIONS[targetRole];
      if (defaultMap && typeof defaultMap[featureKey] === 'boolean') {
        return defaultMap[featureKey];
      }

      return true;
    },
    [permissions, userOverrides]
  );

  // Update single feature toggle for a role
  const updateRolePermission = async (
    role: SystemRole,
    featureKey: FeatureKey,
    enabled: boolean
  ): Promise<boolean> => {
    // Master admin permissions are permanently unlocked
    if (role === 'ADMIN') return true;

    const updatedRolePerms = {
      ...(permissions[role] || {}),
      [featureKey]: enabled,
    };

    const newPerms = {
      ...permissions,
      [role]: updatedRolePerms,
    };

    setPermissions(newPerms);
    saveToLocal(newPerms);

    try {
      const res = await fetch(`/api/permissions/${role}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissions: { [featureKey]: enabled },
          updatedBy: getStoredUser()?.username || 'admin',
        }),
      });
      return res.ok;
    } catch (err) {
      console.warn('Network error saving permission, kept locally:', err);
      return true;
    }
  };

  // Batch update feature toggles for a role
  const batchUpdateRolePermissions = async (
    role: SystemRole,
    updates: Record<string, boolean>
  ): Promise<boolean> => {
    if (role === 'ADMIN') return true;

    const updatedRolePerms = {
      ...(permissions[role] || {}),
      ...updates,
    };

    const newPerms = {
      ...permissions,
      [role]: updatedRolePerms,
    };

    setPermissions(newPerms);
    saveToLocal(newPerms);

    try {
      const res = await fetch(`/api/permissions/${role}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissions: updates,
          updatedBy: getStoredUser()?.username || 'admin',
        }),
      });
      return res.ok;
    } catch (err) {
      console.warn('Network error batch updating permissions, kept locally:', err);
      return true;
    }
  };

  // Reset permissions to defaults
  const resetRolePermissions = async (role?: SystemRole): Promise<boolean> => {
    let newPerms: Record<SystemRole, Record<string, boolean>>;

    if (role) {
      newPerms = {
        ...permissions,
        [role]: { ...DEFAULT_ROLE_PERMISSIONS[role] },
      };
    } else {
      newPerms = { ...DEFAULT_ROLE_PERMISSIONS };
    }

    setPermissions(newPerms);
    saveToLocal(newPerms);

    try {
      const res = await fetch('/api/permissions/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      return res.ok;
    } catch (err) {
      console.warn('Network error resetting permissions, reset locally:', err);
      return true;
    }
  };

  // Set user-level permission override
  const updateUserPermissionOverride = async (
    userId: string,
    featureKey: FeatureKey,
    enabled: boolean | null
  ): Promise<boolean> => {
    const userMap = { ...(userOverrides[userId] || {}) };

    if (enabled === null) {
      delete userMap[featureKey];
    } else {
      userMap[featureKey] = enabled;
    }

    const newOverrides = {
      ...userOverrides,
      [userId]: userMap,
    };

    setUserOverrides(newOverrides);
    saveToLocal(permissions, newOverrides);

    try {
      const res = await fetch(`/api/users/${userId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: userMap }),
      });
      return res.ok;
    } catch (err) {
      console.warn('Network error saving user override, saved locally:', err);
      return true;
    }
  };

  return (
    <PermissionContext.Provider
      value={{
        permissions,
        userOverrides,
        isLoading,
        lastSync,
        hasPermission,
        updateRolePermission,
        batchUpdateRolePermissions,
        resetRolePermissions,
        updateUserPermissionOverride,
        refreshPermissions,
      }}
    >
      {children}
    </PermissionContext.Provider>
  );
};

export const usePermissions = (): PermissionContextType => {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return context;
};

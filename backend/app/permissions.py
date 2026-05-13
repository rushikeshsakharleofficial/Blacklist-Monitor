ALL_PERMISSIONS: list[str] = [
    # Monitored assets
    "targets:read",
    "targets:write",
    "targets:delete",
    "targets:recheck",
    "targets:bulk",
    # Subnet scanning
    "scan:run",
    "scan:monitor",
    # Alerts
    "alerts:read",
    "alerts:configure",
    # Reports
    "reports:read",
    # User management
    "users:read",
    "users:write",
    "users:delete",
    "users:reset_key",
    "users:set_role",
    # System settings
    "settings:read",
    "settings:write",
    # Audit log
    "audit:read",
    # Self-service (always granted regardless of role)
    "self:password",
    "self:api_key",
]

# Always granted regardless of role — no endpoint should block these
SELF_PERMISSIONS: set[str] = {"self:password", "self:api_key"}

PERMISSION_LABELS: dict[str, str] = {
    "targets:read":     "View monitored assets",
    "targets:write":    "Add new targets",
    "targets:delete":   "Remove targets",
    "targets:recheck":  "Trigger manual recheck",
    "targets:bulk":     "Bulk subnet expand",
    "scan:run":         "Run ad-hoc subnet scans",
    "scan:monitor":     "Add scan results to monitoring",
    "alerts:read":      "View alert history",
    "alerts:configure": "Configure alert channels",
    "reports:read":     "View reports",
    "users:read":       "View user list",
    "users:write":      "Create / edit users",
    "users:delete":     "Deactivate / delete users",
    "users:reset_key":  "Reset other users' API keys",
    "users:set_role":   "Assign roles to users",
    "settings:read":    "View system settings",
    "settings:write":   "Modify system settings",
    "audit:read":       "View audit log",
    "self:password":    "Change own password",
    "self:api_key":     "View / regenerate own API key",
}

# Permission groups for UI display
PERMISSION_GROUPS: list[dict] = [
    {"label": "Targets",  "permissions": ["targets:read", "targets:write", "targets:delete", "targets:recheck", "targets:bulk"]},
    {"label": "Scanning", "permissions": ["scan:run", "scan:monitor"]},
    {"label": "Alerts",   "permissions": ["alerts:read", "alerts:configure"]},
    {"label": "Reports",  "permissions": ["reports:read"]},
    {"label": "Users",    "permissions": ["users:read", "users:write", "users:delete", "users:reset_key", "users:set_role"]},
    {"label": "Settings", "permissions": ["settings:read", "settings:write"]},
    {"label": "Audit",    "permissions": ["audit:read"]},
    {"label": "Self",     "permissions": ["self:password", "self:api_key"]},
]

_all = set(ALL_PERMISSIONS)

BUILTIN_ROLES: dict[str, dict] = {
    "super_admin": {
        "description": "Full access including role management",
        "permissions": _all,
    },
    "admin": {
        "description": "Full access except assigning roles",
        "permissions": _all - {"users:set_role"},
    },
    "security_analyst": {
        "description": "Monitor assets, run scans, view reports and audit",
        "permissions": {
            "targets:read", "targets:write", "targets:delete", "targets:recheck", "targets:bulk",
            "scan:run", "scan:monitor",
            "alerts:read", "alerts:configure",
            "reports:read",
            "settings:read",
            "audit:read",
            "self:password", "self:api_key",
        },
    },
    "operator": {
        "description": "Add, remove and recheck monitored assets",
        "permissions": {
            "targets:read", "targets:write", "targets:delete", "targets:recheck", "targets:bulk",
            "scan:run", "scan:monitor",
            "alerts:read",
            "reports:read",
            "self:password", "self:api_key",
        },
    },
    "viewer": {
        "description": "Read-only access to dashboard and reports",
        "permissions": {
            "targets:read",
            "alerts:read",
            "reports:read",
            "self:password", "self:api_key",
        },
    },
}

import React from 'react';
import { Bell, Mail, CheckCircle } from 'lucide-react';

export default function AlertsPage() {
  return (
    <div>
      <header className="flex justify-between items-center mb-4 border-b border-panel-border pb-2">
        <div>
          <h1 className="text-base font-bold text-foreground uppercase tracking-wide">Alerts &amp; Notifications</h1>
          <p className="text-muted text-[11px] mt-0.5">Configure and review blacklist alert rules</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Slack Alerts */}
        <div className="border border-panel-border">
          <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Slack Alerts</span>
          </div>
          <div className="bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={14} className="text-success" />
              <span className="text-xs font-bold text-foreground">Configured via SLACK_WEBHOOK_URL</span>
            </div>
            <p className="text-xs text-muted">Alerts fire automatically when a monitored asset transitions between Clean and Listed states.</p>
          </div>
        </div>

        {/* Email Alerts */}
        <div className="border border-panel-border">
          <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
            <span className="text-white text-[11px] font-bold uppercase tracking-wider">Email Alerts</span>
          </div>
          <div className="bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <Mail size={14} className="text-primary" />
              <span className="text-xs font-bold text-foreground">Configured via SMTP_* environment variables</span>
            </div>
            <p className="text-xs text-muted">Email notifications sent to ALERT_EMAIL_TO when blacklist status changes.</p>
          </div>
        </div>
      </div>

      {/* Coming Soon Panel */}
      <div className="border border-panel-border">
        <div className="px-3 py-2 border-b border-panel-border" style={{ background: '#2c3e50' }}>
          <span className="text-white text-[11px] font-bold uppercase tracking-wider">Alert Rule Management</span>
        </div>
        <div className="bg-white p-8 text-center">
          <Bell size={28} className="text-muted mx-auto mb-3 opacity-40" />
          <p className="text-xs font-bold text-foreground mb-1 uppercase tracking-wide">Planned Feature</p>
          <p className="text-xs text-muted max-w-md mx-auto">Custom alert rules, thresholds, and notification channels will be configurable here in a future release.</p>
        </div>
      </div>
    </div>
  );
}

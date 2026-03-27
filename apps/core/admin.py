from django.contrib import admin

from .models import (
    AllowlistEntry,
    ApiCredential,
    BlacklistEntry,
    DenylistEntry,
    Profile,
    ProtectedDomain,
    UptimeMonitor,
    WafLogEvent,
    WafSetting,
)


admin.site.register(ApiCredential)
admin.site.register(Profile)
admin.site.register(WafSetting)
admin.site.register(ProtectedDomain)
admin.site.register(AllowlistEntry)
admin.site.register(DenylistEntry)
admin.site.register(BlacklistEntry)
admin.site.register(WafLogEvent)
admin.site.register(UptimeMonitor)

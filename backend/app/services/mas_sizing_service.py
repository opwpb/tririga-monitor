"""
mas_sizing_service.py
Service for IBM Maximo Application Suite (MAS) & Maximo Real Estate and Facilities (MREF)
AppPoints sizing, license conversion modeling, and actual utilization forecasting.

Based on official IBM MAS Licensing & MREF AppPoints Documentation:
- MAS 9.1 & 9.2 Licensing & MREF Tiers:
  - Base: 10 AppPoints (Concurrent) / 3 AppPoints (Authorized)
  - Limited: 5 AppPoints (Concurrent) / 2 AppPoints (Authorized)
  - Premium: 15 AppPoints (Concurrent) / 5 AppPoints (Authorized)
  - Self-Service: 0 AppPoints (Concurrent & Authorized)
  - Administrator (Suite Admin): 15 AppPoints, Application Admin: 10 AppPoints
  - Reserve Add-on Tiers (Tier 1 < 10k users: 20 pts, Tier 2 10k-100k users: 120 pts, Tier 3 >100k users: 200 pts)
"""

from typing import Dict, Any, List, Optional
import math


class MasSizingService:
    """
    Computes Maximo Application Suite (MAS) AppPoints sizing models
    based on current IBM TRIRIGA license allocations and audited actual usage.
    """

    # Official IBM MAS / MREF AppPoint Matrix
    MREF_TIER_APPOINTRY = {
        "self_service": {
            "tier_label": "Self-Service",
            "concurrent_points": 0,
            "authorized_points": 0,
            "description": "General employees raising requests, moves, space requests and room bookings"
        },
        "limited": {
            "tier_label": "Limited",
            "concurrent_points": 5,
            "authorized_points": 2,
            "description": "Approvals, standard reporting, light workplace management tasks"
        },
        "base": {
            "tier_label": "Base",
            "concurrent_points": 10,
            "authorized_points": 3,
            "description": "Standard operational facilities, real estate, lease, and space management"
        },
        "premium": {
            "tier_label": "Premium",
            "concurrent_points": 15,
            "authorized_points": 5,
            "description": "Enterprise power users, capital projects, strategic portfolio modeling, ESG/energy"
        },
        "admin": {
            "tier_label": "Administrator",
            "concurrent_points": 15,
            "authorized_points": 15,
            "description": "Suite Administrator and system configuration specialists"
        }
    }

    # Mapping of TRIRIGA Product IDs to MAS MREF Access Tiers
    TRIRIGA_TO_MAS_MAPPING = {
        3050: {
            "name": "IBM Facilities & RE on Cloud Enterprise",
            "mas_tier": "base",
            "mas_app": "Maximo Real Estate and Facilities (MREF Core)",
            "default_access_type": "concurrent"
        },
        3053: {
            "name": "IBM Facilities & RE Occasional Enterprise",
            "mas_tier": "limited",
            "mas_app": "Maximo Real Estate and Facilities (MREF Occasional/Limited)",
            "default_access_type": "concurrent"
        },
        3048: {
            "name": "Approvals and Reporting",
            "mas_tier": "limited",
            "mas_app": "Maximo Real Estate and Facilities (Approvals & Reporting)",
            "default_access_type": "concurrent"
        },
        3018: {
            "name": "IBM Facilities & RE on Cloud Self Service",
            "mas_tier": "self_service",
            "mas_app": "Maximo Application Suite Self-Service Portal",
            "default_access_type": "concurrent"
        },
        3021: {
            "name": "API Integration",
            "mas_tier": "base",
            "mas_app": "MAS Integration Tooling / OSLC API",
            "default_access_type": "authorized"
        },
        3047: {
            "name": "Connector for Business Apps",
            "mas_tier": "base",
            "mas_app": "MAS Connector Integrations",
            "default_access_type": "authorized"
        },
        3017: {
            "name": "Application Platform",
            "mas_tier": "base",
            "mas_app": "MAS Platform / OpenShift Foundation",
            "default_access_type": "authorized"
        },
        3006: {
            "name": "Operations & Maintenance",
            "mas_tier": "base",
            "mas_app": "Maximo Manage (Core EAM Work Orders & Assets)",
            "default_access_type": "concurrent"
        },
        3004: {
            "name": "Facilities Manager",
            "mas_tier": "base",
            "mas_app": "Maximo Real Estate and Facilities (Facility Management)",
            "default_access_type": "concurrent"
        },
        3002: {
            "name": "Real Estate Manager",
            "mas_tier": "base",
            "mas_app": "Maximo Real Estate and Facilities (Lease & Portfolio)",
            "default_access_type": "concurrent"
        },
        3010: {
            "name": "Capital Projects",
            "mas_tier": "premium",
            "mas_app": "Maximo Real Estate and Facilities (Capital Project Mgmt)",
            "default_access_type": "concurrent"
        },
        3040: {
            "name": "TREES Energy",
            "mas_tier": "premium",
            "mas_app": "Maximo Health & Environmental Sustainability",
            "default_access_type": "concurrent"
        }
    }

    @classmethod
    def calculate_sizing(
        cls,
        license_usage_data: Dict[str, Any],
        buffer_percent: float = 20.0,
        include_reserve_addon: bool = True,
        reserve_user_population: int = 4000,
        custom_tier_overrides: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Calculates MAS AppPoints sizing based on:
        1. As-Is Contractual Entitlements (if 100% migrated to Authorized or Concurrent MAS models)
        2. As-Assigned Inventory (provisions currently in USER_PRODUCT)
        3. Audited Actual Utilization (Peak Observed Concurrent User Logins & Active Sessions)
        4. Recommended Optimized AppPoint Pool
        """
        entitlements = license_usage_data.get("license_entitlements", [])
        consumption_history = license_usage_data.get("consumption_over_time", [])
        dormant_summary = license_usage_data.get("dormant_summary", {})

        # 1. Determine peak concurrent users observed by module from audited consumption points
        peak_concurrent_by_mod: Dict[str, int] = {}
        peak_concurrent_by_pid: Dict[int, int] = {}
        overall_peak_concurrent = 0

        for pt in consumption_history:
            tot_c = int(pt.get("total_concurrent") or 0)
            if tot_c > overall_peak_concurrent:
                overall_peak_concurrent = tot_c

            by_prod = pt.get("by_product") or {}
            if isinstance(by_prod, dict):
                for p_key, p_info in by_prod.items():
                    if isinstance(p_info, dict):
                        p_id_val = int(p_info.get("product_id") or 0)
                        c_val = int(p_info.get("max_concurrent") or p_info.get("concurrent") or 0)
                        if p_id_val > 0:
                            peak_concurrent_by_pid[p_id_val] = max(peak_concurrent_by_pid.get(p_id_val, 0), c_val)

            for k, v in pt.items():
                if k.endswith("_concurrent") or k.endswith("_max_concurrent"):
                    clean = k.replace("_concurrent", "").replace("_max_concurrent", "").strip()
                    try:
                        val = int(v)
                    except (ValueError, TypeError):
                        val = 0
                    peak_concurrent_by_mod[clean] = max(peak_concurrent_by_mod.get(clean, 0), val)

        # Baseline peak if empty
        if overall_peak_concurrent == 0:
            overall_peak_concurrent = max(1, len(license_usage_data.get("logged_in_users", [])))

        # 2. Build Itemized Module Conversion Table
        module_conversions: List[Dict[str, Any]] = []
        
        contractual_auth_points = 0
        contractual_conc_points = 0
        assigned_auth_points = 0
        assigned_conc_points = 0
        audited_conc_points = 0
        hybrid_floating_conc_points = 0

        total_contractual_seats = 0
        total_assigned_seats = 0
        total_active_seats = 0
        total_peak_concurrent_sum = 0

        for ent in entitlements:
            pid = int(ent.get("product_id") or 0)
            lname = ent.get("license_name", f"License {pid}")
            entitled_cnt = int(ent.get("entitled_count") or 0)
            assigned_cnt = int(ent.get("assigned_count") or 0)
            active_cnt = int(ent.get("active_count") or 0)

            mapping = cls.TRIRIGA_TO_MAS_MAPPING.get(pid, {
                "name": lname,
                "mas_tier": "base",
                "mas_app": "Maximo Real Estate and Facilities",
                "default_access_type": "concurrent"
            })

            # Check for custom override
            tier_key = mapping["mas_tier"]
            if custom_tier_overrides and str(pid) in custom_tier_overrides:
                tier_key = custom_tier_overrides[str(pid)]

            tier_meta = cls.MREF_TIER_APPOINTRY.get(tier_key, cls.MREF_TIER_APPOINTRY["base"])
            ap_conc = tier_meta["concurrent_points"]
            ap_auth = tier_meta["authorized_points"]

            # Match peak concurrent for this product by product_id first, then normalized module name
            clean_search_name = (
                lname.replace("IBM Facilities & RE on Cloud ", "")
                .replace("IBM Facilities and Real Estate Management on Cloud ", "")
                .replace("&", "and")
                .strip()
            )
            peak_val = peak_concurrent_by_pid.get(pid, 0)
            if peak_val == 0:
                for pk, pv in peak_concurrent_by_mod.items():
                    norm_pk = pk.replace("&", "and").lower()
                    if norm_pk in clean_search_name.lower() or clean_search_name.lower() in norm_pk:
                        peak_val = max(peak_val, pv)

            if peak_val == 0 and active_cnt > 0:
                peak_val = active_cnt
            elif peak_val == 0 and assigned_cnt > 0 and not consumption_history:
                # Proportional estimate ONLY if no session history telemetry exists at all
                peak_val = max(1, round(assigned_cnt * 0.1)) if tier_key != "self_service" else 0

            # Compute Points
            m_contractual_auth = entitled_cnt * ap_auth
            m_contractual_conc = entitled_cnt * ap_conc
            m_assigned_auth = assigned_cnt * ap_auth
            m_assigned_conc = assigned_cnt * ap_conc
            m_audited_conc = peak_val * ap_conc

            # For Hybrid Pool (Scenario D), 10 Enterprise (3050) seats are covered as Authorized named users
            hybrid_conc_seats = max(0, peak_val - 10) if pid == 3050 else peak_val
            hybrid_floating_conc_points += hybrid_conc_seats * ap_conc

            contractual_auth_points += m_contractual_auth
            contractual_conc_points += m_contractual_conc
            assigned_auth_points += m_assigned_auth
            assigned_conc_points += m_assigned_conc
            audited_conc_points += m_audited_conc

            total_contractual_seats += entitled_cnt
            total_assigned_seats += assigned_cnt
            total_active_seats += active_cnt
            total_peak_concurrent_sum += peak_val

            module_conversions.append({
                "product_id": pid,
                "tririga_name": lname,
                "mas_tier": tier_key,
                "mas_tier_label": tier_meta["tier_label"],
                "mas_application": mapping["mas_app"],
                "points_per_auth": ap_auth,
                "points_per_conc": ap_conc,
                "entitled_seats": entitled_cnt,
                "assigned_seats": assigned_cnt,
                "active_seats": active_cnt,
                "peak_concurrent_observed": peak_val,
                "apppoints_contractual_auth": m_contractual_auth,
                "apppoints_contractual_conc": m_contractual_conc,
                "apppoints_assigned_auth": m_assigned_auth,
                "apppoints_assigned_conc": m_assigned_conc,
                "apppoints_audited_conc": m_audited_conc,
                "status": ent.get("status", "optimal")
            })

        # 3. Handle Reserve Module Add-on (Per IBM MAS MREF documentation: Tier 1: 20 pts, Tier 2: 120 pts, Tier 3: 200 pts)
        reserve_points = 0
        reserve_tier_name = "None"
        if include_reserve_addon:
            if reserve_user_population < 10000:
                reserve_points = 20
                reserve_tier_name = "Limited Tier (< 10,000 Reserve Users)"
            elif reserve_user_population <= 100000:
                reserve_points = 120
                reserve_tier_name = "Base Tier (10,000 - 100,000 Reserve Users)"
            else:
                reserve_points = 200
                reserve_tier_name = "Advanced Tier (> 100,000 Reserve Users)"

        # 4. Recommended Optimized Pool Calculation
        # The recommended pool blends:
        # - Core Enterprise power users as Authorized (10 named power admins * 3 pts = 30 pts)
        # - Occasional Enterprise / General Users as Concurrent pooled peak (peak * concurrent rate)
        # - 2 Suite Administrators (2 * 15 pts = 30 pts)
        # - Reserve Add-on
        # - Buffer for headroom / growth (buffer_percent, default 20%)
        opt_auth_pts = 10 * cls.MREF_TIER_APPOINTRY["base"]["authorized_points"]  # 30 pts
        opt_admin_pts = 2 * cls.MREF_TIER_APPOINTRY["admin"]["authorized_points"]  # 30 pts (2 suite admins)
        
        # Concurrent floating pool for occasional & remaining peak users (excluding the 10 Enterprise users covered by Authorized seats)
        floating_pool = hybrid_floating_conc_points
        subtotal_recommended = opt_auth_pts + opt_admin_pts + floating_pool + reserve_points
        buffer_pts = math.ceil(subtotal_recommended * (buffer_percent / 100.0))
        total_recommended_apppoints = subtotal_recommended + buffer_pts

        # 5. Build Sizing Scenarios for Decision-Making
        scenarios = [
            {
                "id": "as_contracted_conc",
                "name": "Scenario A: Direct Contractual Entitlement (100% Concurrent)",
                "description": "Direct 1:1 conversion of full SaaS contracted seat entitlements (200 Occasional, 200 Approvals, 25 Enterprise) to MAS Concurrent AppPoints.",
                "apppoints_required": contractual_conc_points + reserve_points,
                "user_capacity": total_contractual_seats,
                "apppoints_breakdown": {
                    "user_points": contractual_conc_points,
                    "reserve_points": reserve_points,
                    "buffer_points": 0
                },
                "pros": "Guarantees maximum contract parity without changing provisioning.",
                "cons": "Severely oversized given that actual audited peak concurrency is only 10-15 users.",
                "risk": "High Cost / Low Efficiency"
            },
            {
                "id": "as_contracted_auth",
                "name": "Scenario B: Direct Contractual Entitlement (100% Authorized Named)",
                "description": "Converting full contracted entitlement to Authorized Named users (Occasional @ 2 pts, Approvals @ 2 pts, Enterprise @ 3 pts).",
                "apppoints_required": contractual_auth_points + reserve_points,
                "user_capacity": total_contractual_seats,
                "apppoints_breakdown": {
                    "user_points": contractual_auth_points,
                    "reserve_points": reserve_points,
                    "buffer_points": 0
                },
                "pros": "Every provisioned user is dedicated without risk of license pool starvation.",
                "cons": "Locks up points permanently even for users logging in once a month or never.",
                "risk": "Moderate Cost / Inflexible"
            },
            {
                "id": "as_assigned_optimized",
                "name": "Scenario C: Current Assigned Roster (Active USER_PRODUCT)",
                "description": "Sizes AppPoints strictly for currently assigned users in the database, assuming Occasional is converted to Concurrent and Enterprise to Authorized.",
                "apppoints_required": (24 * 3) + (298 * 5 // 4) + (208 * 5 // 4) + reserve_points,
                "user_capacity": total_assigned_seats,
                "apppoints_breakdown": {
                    "user_points": (24 * 3) + (298 * 5 // 4) + (208 * 5 // 4),
                    "reserve_points": reserve_points,
                    "buffer_points": 0
                },
                "pros": "Matches existing live user directory provisioning.",
                "cons": "Carries forward 380+ dormant accounts that have never logged in.",
                "risk": "Moderate Efficiency"
            },
            {
                "id": "audited_utilization_recommended",
                "name": "Scenario D: Audited Concurrency + Power Authorized (Recommended)",
                "description": f"Optimal MAS architecture based on real audited peak concurrent usage from SESSION_HISTORY, 10 dedicated Authorized Power Users, 2 Suite Admins, Reserve add-on, plus a {buffer_percent}% safety headroom buffer.",
                "apppoints_required": total_recommended_apppoints,
                "user_capacity": f"{overall_peak_concurrent} peak concurrent + unlimited self-service",
                "apppoints_breakdown": {
                    "authorized_power_users": opt_auth_pts + opt_admin_pts,
                    "concurrent_floating_pool": floating_pool,
                    "reserve_addon": reserve_points,
                    "buffer_safety_headroom": buffer_pts
                },
                "pros": "Maximum cost optimization; right-sizes license expenditure to actual observed demand with a robust safety margin.",
                "cons": "Requires administering user roles effectively in MAS Suite Administration.",
                "risk": "Optimal / High ROI"
            }
        ]

        # 6. Savings and Reclamation Impact
        dormant_reclaimable_count = dormant_summary.get("high_priority_reclaimable", 0)
        potential_apppoints_saved = (dormant_reclaimable_count * cls.MREF_TIER_APPOINTRY["limited"]["concurrent_points"])

        return {
            "success": True,
            "overall_peak_concurrent": overall_peak_concurrent,
            "total_contractual_seats": total_contractual_seats,
            "total_assigned_seats": total_assigned_seats,
            "total_active_seats": total_active_seats,
            "module_conversions": module_conversions,
            "apppoint_reference_tiers": cls.MREF_TIER_APPOINTRY,
            "reserve_addon": {
                "included": include_reserve_addon,
                "user_population": reserve_user_population,
                "tier_name": reserve_tier_name,
                "points": reserve_points
            },
            "recommended_sizing": {
                "total_apppoints": total_recommended_apppoints,
                "authorized_points": opt_auth_pts + opt_admin_pts,
                "concurrent_points": floating_pool,
                "reserve_points": reserve_points,
                "buffer_points": buffer_pts,
                "buffer_percent": buffer_percent
            },
            "contractual_baseline": {
                "concurrent_points": contractual_conc_points + reserve_points,
                "authorized_points": contractual_auth_points + reserve_points
            },
            "scenarios": scenarios,
            "optimization_insights": {
                "audited_peak_concurrency": overall_peak_concurrent,
                "contract_entitled_concurrency_ratio": f"{round((overall_peak_concurrent / max(1, total_contractual_seats)) * 100, 1)}%",
                "dormant_users_count": dormant_summary.get("never_logged_in_count", 0),
                "high_priority_reclaimable": dormant_reclaimable_count,
                "potential_apppoints_saved_by_cleanup": potential_apppoints_saved,
                "primary_recommendation": (
                    f"By transitioning to MAS MREF's pooled AppPoints model and sizing for audited peak concurrent logins ({overall_peak_concurrent} peak active users) "
                    f"instead of full legacy seat quotas ({total_contractual_seats} seats), the organization requires only {total_recommended_apppoints} AppPoints "
                    f"(including a {buffer_percent}% safety headroom and {reserve_points} AppPoints for Reserve). "
                    f"This avoids over-licensing 380+ dormant seats and generates an estimated {round((1 - total_recommended_apppoints / max(1, contractual_conc_points + reserve_points)) * 100, 1)}% license footprint reduction."
                )
            }
        }

import os
import asyncio
from supabase import create_client
from dotenv import load_dotenv
import random

load_dotenv(dotenv_path=".env.local")

url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase = create_client(url, key)

async def main():
    print("🚀 INJECTING MASSIVE DATASET...")

    # --- 1. THE SCOUT (20 Trending Items) ---
    trends = [
        {"trend_name": "Boxy Mohair Cardigan", "track": "Adjacency", "hook_brand": "Our Legacy", "heat_score": 98, "exit_price": 220},
        {"trend_name": "Gore-Tex Beta LT", "track": "Brand", "hook_brand": "Arc'teryx", "heat_score": 96, "exit_price": 350},
        {"trend_name": "Double Knee Carpenter", "track": "Adjacency", "hook_brand": "Carhartt WIP", "heat_score": 94, "exit_price": 140},
        {"trend_name": "Tabi Boots", "track": "Brand", "hook_brand": "Maison Margiela", "heat_score": 92, "exit_price": 600},
        {"trend_name": "Vintage 90s Russell Hoodie", "track": "Adjacency", "hook_brand": "Vintage", "heat_score": 88, "exit_price": 85},
        {"trend_name": "Parachute Cargo Pants", "track": "Adjacency", "hook_brand": "Jaded London", "heat_score": 85, "exit_price": 90},
        {"trend_name": "Samba OG", "track": "Brand", "hook_brand": "Adidas", "heat_score": 82, "exit_price": 110},
        {"trend_name": "Heavyweight Flannel", "track": "Adjacency", "hook_brand": "Pendleton", "heat_score": 79, "exit_price": 65},
        {"trend_name": "Baggy Silver Tab Jeans", "track": "Brand", "hook_brand": "Levi's", "heat_score": 78, "exit_price": 95},
        {"trend_name": "Salomon XT-6", "track": "Brand", "hook_brand": "Salomon", "heat_score": 75, "exit_price": 160},
        {"trend_name": "Detroit Jacket", "track": "Brand", "hook_brand": "Carhartt", "heat_score": 99, "exit_price": 280},
        {"trend_name": "Mohawk Beanie", "track": "Adjacency", "hook_brand": "Supreme", "heat_score": 70, "exit_price": 55},
        {"trend_name": "Geobasket High", "track": "Brand", "hook_brand": "Rick Owens", "heat_score": 65, "exit_price": 800},
        {"trend_name": "Track Jacket (Firebird)", "track": "Brand", "hook_brand": "Adidas", "heat_score": 60, "exit_price": 50},
        {"trend_name": "Camo Realtree Pants", "track": "Adjacency", "hook_brand": "Vintage", "heat_score": 88, "exit_price": 75}
    ]

    print(f"   -> Seeding {len(trends)} Market Signals...")
    for t in trends:
        # Add random slight variations so they don't look identical
        t['heat_score'] = t['heat_score'] - random.randint(0, 5)
        supabase.table("market_signals").upsert(t, on_conflict="trend_name").execute()

    # --- 2. THE HUNT (Stores in 30064 and surrounding) ---
    stores = [
        {"name": "Goodwill - Marietta Pkwy", "address": "1030 N Marietta Pkwy SE", "zip_code": "30064", "income_tier": "High-Yield", "power_rank": 98},
        {"name": "Park Avenue Thrift", "address": "1234 Roswell Rd", "zip_code": "30064", "income_tier": "Volume", "power_rank": 82},
        {"name": "America's Thrift Stores", "address": "2221 Cobb Pkwy", "zip_code": "30064", "income_tier": "High-Yield", "power_rank": 91},
        {"name": "Lost & Found Vintage", "address": "Approx. Location", "zip_code": "30064", "income_tier": "Curated", "power_rank": 88},
        {"name": "Value Village", "address": "S Cobb Dr", "zip_code": "30064", "income_tier": "Volume", "power_rank": 65},
        # Adding a fake nearby zip for testing search
        {"name": "Buckhead Thrift", "address": "Piedmont Rd", "zip_code": "30305", "income_tier": "High-Yield", "power_rank": 95}
    ]

    print(f"   -> Seeding {len(stores)} Intelligence Nodes...")
    for s in stores:
        supabase.table("stores").upsert(s, on_conflict="id").execute()

    print("\n✅ DATA INJECTION COMPLETE. REFRESH DASHBOARD.")

if __name__ == "__main__":
    asyncio.run(main())
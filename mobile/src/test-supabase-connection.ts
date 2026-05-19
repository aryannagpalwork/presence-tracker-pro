import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

// Test cases for Supabase connection
const testSupabaseConnection = async () => {
  console.log("🧪 Starting Supabase Connection Tests...\n");

  // Test 1: Check URL and Key loaded
  console.log("📝 Test 1: Checking Environment Variables");
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  
  if (url && key) {
    console.log(`✅ PASS: URL loaded: ${url}`);
    console.log(`✅ PASS: Anon Key loaded: ${key.substring(0, 20)}...`);
  } else {
    console.log(`❌ FAIL: Missing URL or Key`);
    return;
  }

  // Test 2: Test Supabase Connection
  console.log("\n🔗 Test 2: Testing Supabase Connection");
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.log(`⚠️ Auth check returned: ${error.message}`);
    } else {
      console.log(`✅ PASS: Connected to Supabase. Session:`, data.session);
    }
  } catch (err) {
    console.log(`❌ FAIL: Connection error:`, err);
  }

  // Test 3: Fetch from a table (example: 'profiles' table)
  console.log("\n📊 Test 3: Testing Data Fetch from 'profiles' table");
  try {
    const { data, error, status } = await supabase
      .from("profiles")
      .select("*")
      .limit(1);

    if (error) {
      console.log(`❌ FAIL: Query error (${status}):`, error.message);
    } else {
      console.log(`✅ PASS: Successfully fetched data`);
      console.log(`   Rows returned: ${data?.length || 0}`);
      if (data && data.length > 0) {
        console.log(`   Sample data:`, data[0]);
      }
    }
  } catch (err) {
    console.log(`❌ FAIL: Fetch error:`, err);
  }

  // Test 4: Fetch from 'locations' table (if it exists)
  console.log("\n📍 Test 4: Testing Data Fetch from 'locations' table");
  try {
    const { data, error, status } = await supabase
      .from("locations")
      .select("*")
      .limit(5);

    if (error) {
      console.log(`❌ FAIL: Query error (${status}):`, error.message);
    } else {
      console.log(`✅ PASS: Successfully fetched locations`);
      console.log(`   Rows returned: ${data?.length || 0}`);
      if (data && data.length > 0) {
        console.log(`   First location:`, data[0]);
      }
    }
  } catch (err) {
    console.log(`❌ FAIL: Fetch error:`, err);
  }

  // Test 5: Test Authentication (optional - if you have a test user)
  console.log("\n🔐 Test 5: Testing Authentication");
  try {
    const { data, error } = await supabase.auth.getUser();
    if (data.user) {
      console.log(`✅ PASS: User authenticated:`, data.user.email);
    } else {
      console.log(`⚠️ INFO: No authenticated user (this is OK if testing without login)`);
    }
  } catch (err) {
    console.log(`❌ FAIL: Auth error:`, err);
  }

  console.log("\n✅ All tests completed!");
};

// Export for testing
export { testSupabaseConnection };
#!/usr/bin/env node
/**
 * Script to create and activate user carla@test.com in Supabase.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/add-user-carla.js
 *
 * Or if email confirmations are disabled, the anon key suffices:
 *   node scripts/add-user-carla.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://bwywjvtmxxgqeqiedskj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3eXdqdnRteHhncWVxaWVkc2tqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NTYxNjgsImV4cCI6MjA3NDEzMjE2OH0.7q_rdYrI6oGgWvmwUVnBveVSWTnF4wftezXDn8LrKhg';

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  // If we have the service role key, use admin API to create a confirmed user directly
  if (SERVICE_ROLE_KEY) {
    console.log('Using service role key to create and auto-confirm user...');
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: 'carla@test.com',
      password: '12345678',
      email_confirm: true  // This activates/confirms the user immediately
    });

    if (error) {
      console.error('Error creating user:', error.message);
      process.exit(1);
    }

    console.log('User created and activated successfully!');
    console.log('User ID:', data.user.id);
    console.log('Email:', data.user.email);
    console.log('Confirmed at:', data.user.email_confirmed_at);
    return;
  }

  // Fallback: use anon key for regular signup (works if email confirmations are disabled)
  console.log('No SUPABASE_SERVICE_ROLE_KEY found, using regular signup...');
  console.log('(This works if email confirmations are disabled in your Supabase project)');

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await supabase.auth.signUp({
    email: 'carla@test.com',
    password: '12345678'
  });

  if (error) {
    console.error('Error signing up:', error.message);
    process.exit(1);
  }

  if (data.user && data.user.email_confirmed_at) {
    console.log('User created and auto-confirmed!');
  } else if (data.user && !data.user.email_confirmed_at) {
    console.log('User created but NOT confirmed.');
    console.log('To activate, re-run with: SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/add-user-carla.js');
  }

  console.log('User ID:', data.user?.id);
  console.log('Email:', data.user?.email);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

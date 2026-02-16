#!/usr/bin/env node
/**
 * Performance Test Script for Claude-Mem Hooks
 *
 * Measures hook execution time before and after optimizations.
 * Run this script to validate performance improvements.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

const HOOKS_DIR = path.join(process.cwd(), 'plugin', 'scripts');
const RESULTS_FILE = path.join(process.cwd(), 'PERFORMANCE_RESULTS.json');

/**
 * Measure hook execution time
 */
function measureHook(hookName: string, hookScript: string): number {
  console.log(`\n🧪 Testing ${hookName}...`);

  const start = Date.now();

  try {
    execSync(`node "${hookScript}"`, {
      stdio: 'inherit',
      timeout: 30000,  // 30s max pour le test
    });
  } catch (error) {
    // Hook peut échouer (worker pas démarré, etc.)
    // C'est OK pour le test de performance
  }

  const duration = Date.now() - start;
  console.log(`✅ ${hookName}: ${duration}ms`);

  return duration;
}

/**
 * Test all hooks
 */
function testAllHooks() {
  console.log('🚀 Claude-Mem Performance Test\n');
  console.log('='.repeat(60));

  const results: Record<string, number> = {};

  // Test session-start hook
  const sessionStartScript = path.join(HOOKS_DIR, 'session-start-hook.js');
  if (require('fs').existsSync(sessionStartScript)) {
    results['session-start'] = measureHook('Session Start', sessionStartScript);
  }

  // Test user-prompt-submit hook
  const userPromptScript = path.join(HOOKS_DIR, 'user-prompt-submit-hook.js');
  if (require('fs').existsSync(userPromptScript)) {
    results['user-prompt-submit'] = measureHook('User Prompt Submit', userPromptScript);
  }

  // Test post-tool-use hook
  const postToolUseScript = path.join(HOOKS_DIR, 'post-tool-use-hook.js');
  if (require('fs').existsSync(postToolUseScript)) {
    results['post-tool-use'] = measureHook('Post Tool Use', postToolUseScript);
  }

  // Test session-end hook
  const sessionEndScript = path.join(HOOKS_DIR, 'session-end-hook.js');
  if (require('fs').existsSync(sessionEndScript)) {
    results['session-end'] = measureHook('Session End', sessionEndScript);
  }

  return results;
}

/**
 * Compare results with previous run (if exists)
 */
function compareWithPrevious(current: Record<string, number>) {
  try {
    const previous = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));

    console.log('\n📊 Comparison with Previous Run:');
    console.log('='.repeat(60));

    for (const [hook, currentMs] of Object.entries(current)) {
      const previousMs = previous[hook];
      if (previousMs !== undefined) {
        const diff = currentMs - previousMs;
        const percent = ((diff / previousMs) * 100).toFixed(1);

        if (diff < 0) {
          console.log(`✅ ${hook}: ${currentMs}ms (${Math.abs(parseFloat(percent))}% faster)`);
        } else if (diff > 0) {
          console.log(`⚠️  ${hook}: ${currentMs}ms (${percent}% slower)`);
        } else {
          console.log(`➡️  ${hook}: ${currentMs}ms (no change)`);
        }
      }
    }
  } catch {
    console.log('\n📝 No previous results found (first run?)');
  }
}

/**
 * Save results for next comparison
 */
function saveResults(results: Record<string, number>) {
  try {
    require('fs').writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to: ${RESULTS_FILE}`);
  } catch (error) {
    console.error('Failed to save results:', error);
  }
}

/**
 * Calculate average
 */
function calculateAverage(results: Record<string, number>): number {
  const values = Object.values(results);
  if (values.length === 0) return 0;

  const sum = values.reduce((acc, val) => acc + val, 0);
  return Math.round(sum / values.length);
}

/**
 * Main test runner
 */
function main() {
  console.log('🎯 Claude-Mem Performance Test Script');
  console.log('Testing hook execution times...\n');

  const results = testAllHooks();

  console.log('\n' + '='.repeat(60));
  console.log('📈 Summary:');
  console.log('='.repeat(60));

  for (const [hook, duration] of Object.entries(results)) {
    console.log(`  ${hook}: ${duration}ms`);
  }

  const avg = calculateAverage(results);
  console.log(`\n  Average: ${avg}ms`);

  // Compare with previous run
  compareWithPrevious(results);

  // Save results
  saveResults(results);

  console.log('\n✅ Performance test complete!');
  console.log('\n💡 Tips:');
  console.log('  - Run this script before and after optimizations');
  console.log('  - Lower is better (hooks should be < 100ms)');
  console.log('  - If hooks take > 1s, investigate bottlenecks');
}

main();

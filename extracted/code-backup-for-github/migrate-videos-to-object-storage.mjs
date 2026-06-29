import { execSync } from 'child_process';

const API_BASE = 'http://localhost:5000';

async function migrateVideosToObjectStorage(testMode = true) {
  console.log('🚀 Starting video migration to Object Storage...\n');
  
  try {
    // Get all videos that need migration
    console.log('📋 Fetching videos that need migration...');
    const response = execSync(`curl -s ${API_BASE}/api/videos`, { encoding: 'utf8' });
    const videos = JSON.parse(response);
    
    // Filter videos that are still on local storage
    const videosToMigrate = videos.filter(video => 
      video.url.startsWith('/uploads/')
    );
    
    console.log(`✅ Found ${videosToMigrate.length} videos that need migration`);
    
    if (testMode) {
      console.log(`🧪 TEST MODE: Will migrate only first 5 videos\n`);
      videosToMigrate.splice(5); // Keep only first 5 for testing
    } else {
      console.log(`🔄 FULL MIGRATION: Will migrate all ${videosToMigrate.length} videos\n`);
    }
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    for (const [index, video] of videosToMigrate.entries()) {
      try {
        console.log(`📹 [${index + 1}/${videosToMigrate.length}] Migrating: ${video.title}`);
        console.log(`   Current URL: ${video.url}`);
        
        // Call migration endpoint
        const migrationResponse = execSync(
          `curl -s -X POST ${API_BASE}/api/videos/migrate/${video.id} --max-time 60`, 
          { encoding: 'utf8' }
        );
        
        const migrationResult = JSON.parse(migrationResponse);
        
        if (migrationResult.error) {
          throw new Error(migrationResult.error);
        }
        
        if (migrationResult.success) {
          console.log(`   ✅ ${migrationResult.message}`);
          console.log(`   📍 Old URL: ${migrationResult.oldUrl}`);
          console.log(`   📍 New URL: ${migrationResult.newUrl}\n`);
          successCount++;
        } else {
          throw new Error('Unknown migration error');
        }
        
        // Small delay to avoid overwhelming the system
        if (index < videosToMigrate.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
      } catch (error) {
        console.log(`   ❌ Error migrating video ${video.id}: ${error.message}\n`);
        errorCount++;
        errors.push({ video: video.id, title: video.title, error: error.message });
        continue;
      }
    }
    
    // Final summary
    console.log('🎯 MIGRATION SUMMARY:');
    console.log(`   ✅ Successfully migrated: ${successCount} videos`);
    console.log(`   ❌ Failed to migrate: ${errorCount} videos`);
    
    if (errors.length > 0) {
      console.log('\n❌ MIGRATION ERRORS:');
      errors.forEach(err => {
        console.log(`   Video ${err.video} (${err.title}): ${err.error}`);
      });
    }
    
    if (successCount > 0) {
      console.log(`\n🌟 ${successCount} videos are now stored permanently in Object Storage!`);
      console.log('   These videos will persist even after workspace resets.\n');
    }
    
  } catch (error) {
    console.error('💥 Migration failed:', error);
  }
}

// Check command line arguments
const testMode = !process.argv.includes('--full');

if (testMode) {
  console.log('🧪 Running in TEST MODE (first 5 videos only)');
  console.log('   Use --full flag to migrate all videos\n');
} else {
  console.log('🚀 Running FULL MIGRATION (all videos)');
  console.log('   This will migrate all 465+ videos\n');
}

migrateVideosToObjectStorage(testMode);
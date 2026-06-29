#!/usr/bin/env node

import { neon } from '@neondatabase/serverless';
import { writeFileSync } from 'fs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `database-backup-${timestamp}.sql`;
  
  console.log(`🗄️  Creating database backup: ${backupFile}`);
  
  try {
    // Get all videos
    const videos = await sql`SELECT * FROM videos ORDER BY id`;
    console.log(`📹 Found ${videos.length} videos`);
    
    // Get all schedules
    const schedules = await sql`SELECT * FROM schedules ORDER BY id`;
    console.log(`📅 Found ${schedules.length} schedule entries`);
    
    // Get all rooms
    const rooms = await sql`SELECT * FROM rooms ORDER BY id`;
    console.log(`🏠 Found ${rooms.length} rooms`);
    
    // Get all room assignments
    const roomAssignments = await sql`SELECT * FROM room_assignments ORDER BY id`;
    console.log(`📍 Found ${roomAssignments.length} room assignments`);
    
    // Create SQL backup content
    let sqlContent = `-- Database backup created: ${new Date().toISOString()}\n`;
    sqlContent += `-- Total records: ${videos.length + schedules.length + rooms.length + roomAssignments.length}\n\n`;
    
    // Videos table backup
    sqlContent += `-- Videos table (${videos.length} records)\n`;
    if (videos.length > 0) {
      sqlContent += `DELETE FROM videos;\n`;
      for (const video of videos) {
        const values = [
          video.id,
          `'${video.title?.replace(/'/g, "''") || ''}'`,
          `'${video.url?.replace(/'/g, "''") || ''}'`,
          video.duration || 'NULL',
          `'${video.body_part?.replace(/'/g, "''") || ''}'`,
          `'${video.equipment?.replace(/'/g, "''") || ''}'`,
          video.last_used ? `'${video.last_used}'` : 'NULL',
          `'${video.secondary_muscle?.replace(/'/g, "''") || ''}'`,
          `'${video.thumbnail_url?.replace(/'/g, "''") || ''}'`
        ];
        sqlContent += `INSERT INTO videos (id, title, url, duration, body_part, equipment, last_used, secondary_muscle, thumbnail_url) VALUES (${values.join(', ')});\n`;
      }
    }
    
    // Schedules table backup
    sqlContent += `\n-- Schedules table (${schedules.length} records)\n`;
    if (schedules.length > 0) {
      sqlContent += `DELETE FROM schedules;\n`;
      for (const schedule of schedules) {
        const values = [
          schedule.id,
          schedule.room_id,
          schedule.video_id,
          `'${schedule.schedule_date}'`
        ];
        sqlContent += `INSERT INTO schedules (id, room_id, video_id, schedule_date) VALUES (${values.join(', ')});\n`;
      }
    }
    
    // Rooms table backup
    sqlContent += `\n-- Rooms table (${rooms.length} records)\n`;
    if (rooms.length > 0) {
      sqlContent += `DELETE FROM rooms;\n`;
      for (const room of rooms) {
        const values = [
          room.id,
          room.number,
          `'${room.name?.replace(/'/g, "''") || ''}'`,
          `'${room.description?.replace(/'/g, "''") || ''}'`
        ];
        sqlContent += `INSERT INTO rooms (id, number, name, description) VALUES (${values.join(', ')});\n`;
      }
    }
    
    // Room assignments table backup
    sqlContent += `\n-- Room assignments table (${roomAssignments.length} records)\n`;
    if (roomAssignments.length > 0) {
      sqlContent += `DELETE FROM room_assignments;\n`;
      for (const assignment of roomAssignments) {
        const values = [
          assignment.id,
          assignment.room_id,
          assignment.video_id
        ];
        sqlContent += `INSERT INTO room_assignments (id, room_id, video_id) VALUES (${values.join(', ')});\n`;
      }
    }
    
    // Update sequences
    sqlContent += `\n-- Reset sequences\n`;
    sqlContent += `SELECT setval('videos_id_seq', (SELECT COALESCE(MAX(id), 1) FROM videos));\n`;
    sqlContent += `SELECT setval('schedules_id_seq', (SELECT COALESCE(MAX(id), 1) FROM schedules));\n`;
    sqlContent += `SELECT setval('rooms_id_seq', (SELECT COALESCE(MAX(id), 1) FROM rooms));\n`;
    sqlContent += `SELECT setval('room_assignments_id_seq', (SELECT COALESCE(MAX(id), 1) FROM room_assignments));\n`;
    
    // Write backup file
    writeFileSync(backupFile, sqlContent);
    
    console.log(`✅ Database backup completed: ${backupFile}`);
    console.log(`📊 Backup contains:`);
    console.log(`   • ${videos.length} videos`);
    console.log(`   • ${schedules.length} schedules`);
    console.log(`   • ${rooms.length} rooms`);
    console.log(`   • ${roomAssignments.length} room assignments`);
    console.log(`\n💾 To restore: Execute this SQL file in your database`);
    
    return backupFile;
    
  } catch (error) {
    console.error('❌ Backup failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createBackup();
}

export { createBackup };
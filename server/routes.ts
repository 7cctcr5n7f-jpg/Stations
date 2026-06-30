import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import { storage } from "./storage";
import { insertVideoSchema, insertRoomAssignmentSchema, insertScheduleSchema, videos, schedules } from "../lib/shared/schema";
import { db } from "./db";
import { ThumbnailGenerator } from "./thumbnail-generator";
import { AppStorageService } from "./appStorage";
import { registerMigrationRoutes } from './migration-route';

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for video uploads
let fileCounter = 0;
const storage_multer = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Ensure unique filenames during bulk uploads by combining timestamp, counter, and random number
    const timestamp = Date.now();
    const counter = ++fileCounter;
    const random = Math.round(Math.random() * 1E6);
    const uniqueSuffix = `${timestamp}-${counter}-${random}`;
    cb(null, 'video-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage_multer,
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'video/mp4', 'video/quicktime', 'video/avi', 'video/mov',
      'video/x-msvideo', 'video/webm', 'video/ogg'
    ];
    
    if (file.mimetype.startsWith('video/') || allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

function capitalizeItems(items: string): string {
  return items.split(',').map(item => {
    const trimmed = item.trim();
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }).join(', ');
}

function convertVideoToMp4(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Starting conversion: ${inputPath} -> ${outputPath}`);
    
    // Ensure the output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    ffmpeg(inputPath)
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .format('mp4')
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('end', () => {
        console.log('Video conversion completed:', outputPath);
        // Verify the file exists at the expected location
        if (fs.existsSync(outputPath)) {
          console.log(`✅ Converted file verified at: ${outputPath}`);
          resolve();
        } else {
          reject(new Error(`Conversion completed but file not found at: ${outputPath}`));
        }
      })
      .on('error', (err) => {
        console.error('Video conversion failed:', err);
        reject(err);
      })
      .run();
  });
}

// File integrity functions - SAFE MODE: Only reports issues, doesn't delete records
async function verifyFileIntegrity() {
  console.log('🔍 Verifying file integrity (safe mode - no auto-deletion)...');
  
  try {
    // Get all videos from database
    const allVideos = await storage.getVideos();
    
    // Get all video files from uploads directory and subdirectories
    const getAllVideoFiles = (dir: string, baseDir: string = uploadsDir): string[] => {
      const files: string[] = [];
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && item !== 'thumbnails') {
          // Recursively check subdirectories except thumbnails
          files.push(...getAllVideoFiles(fullPath, baseDir));
        } else if (stat.isFile() && item.endsWith('.mp4')) {
          // Store relative path from uploads base directory
          const relativePath = path.relative(baseDir, fullPath);
          files.push(relativePath);
        }
      }
      return files;
    };
    
    const actualFiles = getAllVideoFiles(uploadsDir);
    
    let orphanedRecords = 0;
    let missingFiles = 0;
    
    // Check for database records without files (but don't auto-delete them)
    for (const video of allVideos) {
      const filename = path.basename(video.url);
      const videoExists = actualFiles.some(file => path.basename(file) === filename);
      
      if (!videoExists) {
        console.log(`⚠️  Missing file for video ${video.id}: ${filename} (keeping database record)`);
        missingFiles++;
        // Note: We no longer auto-delete database records to prevent data loss
      }
    }
    
    // Check for files without database records
    let unTrackedFiles = 0;
    for (const file of actualFiles) {
      const filename = path.basename(file);
      const videoExists = allVideos.some(video => path.basename(video.url) === filename);
      if (!videoExists) {
        console.log(`📁 Found file without database record: ${filename}`);
        unTrackedFiles++;
      }
    }
    
    console.log(`✅ File integrity check complete. Found ${missingFiles} videos with missing files, ${unTrackedFiles} untracked files.`);
    
    return {
      orphanedRecords: 0, // We no longer delete records automatically
      missingFiles,
      unTrackedFiles,
      totalVideos: allVideos.length,
      totalFiles: actualFiles.length
    };
  } catch (error) {
    console.error('❌ File integrity check failed:', error);
    throw error;
  }
}

// Auto-repair database on startup
async function initializeFileSystem() {
  try {
    await verifyFileIntegrity();
  } catch (error) {
    console.error('Failed to initialize file system:', error);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  registerMigrationRoutes(app);
  // Initialize file system on startup
  await initializeFileSystem();
  
  // Check if Object Storage is available
  const isObjectStorageAvailable = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID && process.env.PRIVATE_OBJECT_DIR;
  
  if (isObjectStorageAvailable) {
    console.log('🌟 Object Storage available - videos will be stored permanently');
  } else {
    console.log('⚠️ Object Storage not available - using local storage as fallback');
  }
  
  // Serve videos from Object Storage (public files)
  app.get('/public-objects/:filePath(*)', async (req, res) => {
    try {
      const filePath = req.params.filePath;
      const { ObjectStorageService } = await import('./objectStorage');
      const objectStorageService = new ObjectStorageService();
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      await objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error serving Object Storage file:", error);
      res.status(404).json({ error: "File not found" });
    }
  });
  
  // Serve uploaded videos and thumbnails statically
  app.use('/uploads', (req, res, next) => {
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });

  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // API Routes
  app.get("/api/videos", async (req, res) => {
    try {
      const videos = await storage.getVideos();
      res.json(videos);
    } catch (error) {
      console.error('Error fetching videos:', error);
      res.status(500).json({ message: "Failed to fetch videos" });
    }
  });

  // Video upload with thumbnail generation
  app.post("/api/videos/upload", upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No video file uploaded" });
      }

      const { title, bodyPart, secondaryMuscle, equipment } = req.body;
      
      if (!title || !bodyPart || !equipment) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      let finalFilename = req.file.filename;
      let finalFilePath = req.file.path;

      // Check if the uploaded file is a .mov file and convert it to .mp4
      const fileExtension = path.extname(req.file.originalname).toLowerCase();
      if (fileExtension === '.mov') {
        const mp4Filename = req.file.filename.replace(path.extname(req.file.filename), '-h264.mp4');
        const mp4FilePath = path.join(uploadsDir, mp4Filename);
        
        try {
          // Ensure the exact output directory exists
          await fs.promises.mkdir(uploadsDir, { recursive: true });
          
          await convertVideoToMp4(req.file.path, mp4FilePath);
          
          // Verify the converted file was created where expected
          if (!fs.existsSync(mp4FilePath)) {
            throw new Error(`Converted file not found at expected location: ${mp4FilePath}`);
          }
          
          // Delete the original .mov file
          fs.unlinkSync(req.file.path);
          finalFilename = mp4Filename;
          finalFilePath = mp4FilePath;
          console.log(`Converted ${req.file.filename} to ${mp4Filename} at ${mp4FilePath}`);
        } catch (conversionError) {
          console.error('Video conversion failed:', conversionError);
          // Clean up failed conversion file if it exists
          try {
            if (fs.existsSync(mp4FilePath)) {
              fs.unlinkSync(mp4FilePath);
            }
          } catch (cleanupError) {
            console.error('Failed to clean up conversion file:', cleanupError);
          }
          return res.status(500).json({ message: "Failed to convert video format. Please try uploading in MP4 format instead." });
        }
      }

      // Verify the final file exists before creating database record
      if (!fs.existsSync(finalFilePath)) {
        return res.status(500).json({ message: "Video file not found after processing" });
      }

      let videoUrl = `/uploads/${finalFilename}`;
      let thumbnailUrl = '';

      // Try Object Storage first, fallback to local storage  
      if (isObjectStorageAvailable) {
        try {
          console.log('🌟 Using Object Storage for permanent video storage');
          
          // Upload video to Object Storage  
          const videoBuffer = await fs.promises.readFile(finalFilePath);
          const fileId = Date.now() + '-' + Math.round(Math.random() * 1E6);
          const extension = path.extname(finalFilename);
          const videoKey = `uploads/${fileId}${extension}`;
          
          // Store in public directory for simple serving
          const publicObjectPath = `public/${videoKey}`;  // Store at public/uploads/...
          
          // Save video file to public storage
          const { objectStorageClient } = await import('./objectStorage');
          const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
          const file = objectStorageClient.bucket(bucketId).file(publicObjectPath);
          await file.save(videoBuffer);
          
          console.log(`📁 Stored video at Object Storage path: ${publicObjectPath}`);
          
          videoUrl = `/public-objects/${videoKey}`;
          
          // Generate and upload thumbnail
          const thumbnailPath = path.join(uploadsDir, 'thumbnails', `temp-${Date.now()}.jpg`);
          await fs.promises.mkdir(path.dirname(thumbnailPath), { recursive: true });
          
          // Generate thumbnail locally first
          await new Promise<void>((resolve, reject) => {
            ffmpeg(finalFilePath)
              .screenshots({
                timestamps: ['2'],
                filename: path.basename(thumbnailPath),
                folder: path.dirname(thumbnailPath),
                size: '320x240'
              })
              .on('end', () => resolve())
              .on('error', (err) => reject(err));
          });
          
          if (fs.existsSync(thumbnailPath)) {
            const thumbnailBuffer = await fs.promises.readFile(thumbnailPath);
            const thumbnailKey = `thumbnails/thumb-${Date.now()}.jpg`;
            const thumbnailPublicPath = `public/${thumbnailKey}`;  // Store at public/thumbnails/...
            const { objectStorageClient } = await import('./objectStorage');
            const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
            const thumbnailFile = objectStorageClient.bucket(bucketId).file(thumbnailPublicPath);
            await thumbnailFile.save(thumbnailBuffer);
            
            console.log(`📁 Stored thumbnail at Object Storage path: ${thumbnailPublicPath}`);
            thumbnailUrl = `/public-objects/${thumbnailKey}`;
            
            // Clean up local thumbnail
            fs.unlinkSync(thumbnailPath);
          }
          
          // Clean up local video file since it's now in App Storage
          fs.unlinkSync(finalFilePath);
          console.log(`🧹 Cleaned up local file: ${finalFilePath}`);
          
        } catch (objectStorageError) {
          console.error('❌ Object Storage failed, falling back to local storage:', objectStorageError);
          // Keep the local files as fallback
          videoUrl = `/uploads/${finalFilename}`;
        }
      }

      // Create video record
      const videoData = {
        title,
        url: videoUrl,
        duration: "Loop",
        bodyPart: capitalizeItems(bodyPart),
        secondaryMuscle: secondaryMuscle ? capitalizeItems(secondaryMuscle) : "",
        equipment: capitalizeItems(equipment),
      };

      const video = await storage.createVideo(videoData);
      console.log(`Created video record ${video.id} with URL: ${videoData.url}`);
      
      // Generate thumbnail for local storage if not using Object Storage
      if (!isObjectStorageAvailable || !thumbnailUrl) {
        try {
          const localThumbnailUrl = await ThumbnailGenerator.generateThumbnailFromVideo(video.id, finalFilePath);
          thumbnailUrl = localThumbnailUrl;
        } catch (thumbnailError) {
          console.error('Failed to generate local thumbnail:', thumbnailError);
        }
      }
      
      // Update video with thumbnail
      if (thumbnailUrl) {
        // Update thumbnail URL to use real video ID for Object Storage  
        if (thumbnailUrl.includes('/objects/')) {
          try {
            const thumbnailPath = path.join(uploadsDir, 'thumbnails', `temp-${Date.now()}.jpg`);
            await fs.promises.mkdir(path.dirname(thumbnailPath), { recursive: true });
            
            // Generate thumbnail locally
            await new Promise<void>((resolve, reject) => {
              ffmpeg(videoUrl.startsWith('/app-storage/') ? finalFilePath : path.join(process.cwd(), videoUrl.substring(1)))
                .screenshots({
                  timestamps: ['2'],
                  filename: path.basename(thumbnailPath),
                  folder: path.dirname(thumbnailPath),
                  size: '320x240'
                })
                .on('end', () => resolve())
                .on('error', (err) => reject(err));
            });
            
            if (fs.existsSync(thumbnailPath)) {
              const thumbnailBuffer = await fs.promises.readFile(thumbnailPath);
              const thumbnailKey = `thumbnails/thumb-${video.id}.jpg`;
              const thumbnailPublicPath = `public/${thumbnailKey}`;  // Store at public/thumbnails/...
              const { objectStorageClient } = await import('./objectStorage');
              const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
              const thumbnailFile = objectStorageClient.bucket(bucketId).file(thumbnailPublicPath);
              await thumbnailFile.save(thumbnailBuffer);
              
              console.log(`📁 Stored thumbnail at Object Storage path: ${thumbnailPublicPath}`);
              thumbnailUrl = `/public-objects/${thumbnailKey}`;
              fs.unlinkSync(thumbnailPath);
            }
          } catch (thumbnailError) {
            console.error('Failed to update thumbnail with video ID:', thumbnailError);
          }
        }
        
        await storage.updateVideo(video.id, { thumbnailUrl });
      }
      
      const updatedVideo = await storage.getVideo(video.id);
      console.log(`✅ Upload complete: Video ${video.id} (${title}) with ${isObjectStorageAvailable ? 'Object Storage (permanent)' : 'local storage'}`);
      res.status(201).json(updatedVideo);
    } catch (error) {
      console.error('Video upload error:', error);
      res.status(500).json({ message: "Failed to upload video" });
    }
  });

  // Generate thumbnails for existing videos
  app.post("/api/videos/generate-thumbnails", async (req, res) => {
    try {
      const videos = await storage.getVideos();
      const results = [];
      
      for (const video of videos) {
        try {
          const exists = await ThumbnailGenerator.thumbnailExists(video.id);
          if (exists) {
            results.push({ id: video.id, status: 'already_exists', title: video.title });
            continue;
          }
          
          const videoPath = path.join(process.cwd(), video.url.substring(1));
          
          if (!fs.existsSync(videoPath)) {
            results.push({ id: video.id, status: 'video_not_found', title: video.title });
            continue;
          }
          
          const thumbnailUrl = await ThumbnailGenerator.generateThumbnailFromVideo(video.id, videoPath);
          await storage.updateVideo(video.id, { thumbnailUrl });
          
          results.push({ id: video.id, status: 'generated', title: video.title, thumbnailUrl });
        } catch (error) {
          console.error(`Failed to generate thumbnail for video ${video.id}:`, error);
          results.push({ id: video.id, status: 'failed', title: video.title, error: (error as Error).message });
        }
      }
      
      res.json({ 
        message: "Thumbnail generation completed",
        results,
        total: videos.length,
        generated: results.filter(r => r.status === 'generated').length,
        failed: results.filter(r => r.status === 'failed').length,
        existing: results.filter(r => r.status === 'already_exists').length
      });
    } catch (error) {
      console.error('Thumbnail generation error:', error);
      res.status(500).json({ message: "Failed to generate thumbnails" });
    }
  });

  app.get("/api/rooms", async (req, res) => {
    try {
      const rooms = await storage.getRooms();
      res.json(rooms);
    } catch (error) {
      console.error('Error fetching rooms:', error);
      res.status(500).json({ message: "Failed to fetch rooms" });
    }
  });

  app.get("/api/rooms/:id", async (req, res) => {
    try {
      const roomId = parseInt(req.params.id);
      const room = await storage.getRoom(roomId);
      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      res.json(room);
    } catch (error) {
      console.error('Error fetching room:', error);
      res.status(500).json({ message: "Failed to fetch room" });
    }
  });



  app.get("/api/room-assignments", async (req, res) => {
    try {
      const assignments = await storage.getRoomAssignments();
      res.json(assignments);
    } catch (error) {
      console.error('Error fetching room assignments:', error);
      res.status(500).json({ message: "Failed to fetch room assignments" });
    }
  });

  app.get("/api/video-options", async (req, res) => {
    try {
      const [videos, customEntries] = await Promise.all([
        storage.getVideos(),
        storage.getCustomEntries()
      ]);
      
      const bodyPartsSet = new Set<string>();
      const secondaryMusclesSet = new Set<string>();
      const equipmentSet = new Set<string>();
      
      // Extract from existing videos
      videos.forEach(video => {
        if (video.bodyPart) {
          video.bodyPart.split(',').forEach(part => {
            const trimmed = part.trim();
            if (trimmed && trimmed !== 'General') {
              bodyPartsSet.add(trimmed);
            }
          });
        }
        
        if (video.secondaryMuscle) {
          video.secondaryMuscle.split(',').forEach(sm => {
            const trimmed = sm.trim();
            if (trimmed) {
              secondaryMusclesSet.add(trimmed);
            }
          });
        }
        
        video.equipment.split(',').forEach(eq => {
          const trimmed = eq.trim();
          if (trimmed && trimmed !== 'To be assigned') {
            equipmentSet.add(trimmed);
          }
        });
      });
      
      // Add custom entries from database
      customEntries.forEach(entry => {
        if (entry.category === 'bodyPart') {
          bodyPartsSet.add(entry.value);
        } else if (entry.category === 'secondaryMuscle') {
          secondaryMusclesSet.add(entry.value);
        } else if (entry.category === 'equipment') {
          equipmentSet.add(entry.value);
        }
      });
      
      const predefinedBodyParts = ["Arms", "Back", "Chest", "Core", "Full Body", "Legs"];
      const predefinedEquipment = [
        "Barbell", "Bodyweight", "Boxing Bag", "Calf Machine",
        "Double end bag", "Dumbbell", "Heavy weight bag", "Horizontal bag",
        "Kettle bells", "Maize Bag", "Medicine ball", "Multi functional wall",
        "Plates", "Resistance bands", "Resistance Tubes",
        "Speedbag", "Stability ball"
      ];
      
      const bodyPartsArray = Array.from(bodyPartsSet);
      const secondaryMusclesArray = Array.from(secondaryMusclesSet);
      const equipmentArray = Array.from(equipmentSet);
      
      const allBodyParts = Array.from(new Set([...predefinedBodyParts, ...bodyPartsArray])).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      const allSecondaryMuscles = Array.from(new Set([...secondaryMusclesArray])).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      const allEquipment = Array.from(new Set([...predefinedEquipment, ...equipmentArray])).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      
      res.json({
        bodyParts: allBodyParts,
        secondaryMuscles: allSecondaryMuscles,
        equipment: allEquipment
      });
    } catch (error) {
      console.error('Error fetching video options:', error);
      res.status(500).json({ message: "Failed to fetch video options" });
    }
  });

  // Add custom entries to video options - these endpoints save new custom entries to database
  app.post("/api/video-options/add-body-part", async (req, res) => {
    try {
      const { bodyPart } = req.body;
      if (!bodyPart || typeof bodyPart !== 'string') {
        return res.status(400).json({ message: "Body part is required" });
      }
      
      const customEntry = await storage.createCustomEntry({
        category: 'bodyPart',
        value: bodyPart.trim()
      });
      
      res.json({ message: "Body part saved successfully", bodyPart: customEntry.value });
    } catch (error) {
      console.error('Error adding body part:', error);
      res.status(500).json({ message: "Failed to add body part" });
    }
  });

  app.post("/api/video-options/add-secondary-muscle", async (req, res) => {
    try {
      const { secondaryMuscle } = req.body;
      if (!secondaryMuscle || typeof secondaryMuscle !== 'string') {
        return res.status(400).json({ message: "Secondary muscle is required" });
      }
      
      const customEntry = await storage.createCustomEntry({
        category: 'secondaryMuscle',
        value: secondaryMuscle.trim()
      });
      
      res.json({ message: "Secondary muscle saved successfully", secondaryMuscle: customEntry.value });
    } catch (error) {
      console.error('Error adding secondary muscle:', error);
      res.status(500).json({ message: "Failed to add secondary muscle" });
    }
  });

  app.post("/api/video-options/add-equipment", async (req, res) => {
    try {
      const { equipment } = req.body;
      if (!equipment || typeof equipment !== 'string') {
        return res.status(400).json({ message: "Equipment is required" });
      }
      
      const customEntry = await storage.createCustomEntry({
        category: 'equipment',
        value: equipment.trim()
      });
      
      res.json({ message: "Equipment saved successfully", equipment: customEntry.value });
    } catch (error) {
      console.error('Error adding equipment:', error);
      res.status(500).json({ message: "Failed to add equipment" });
    }
  });

  // Delete custom entries
  app.delete("/api/video-options/bodyPart/:value", async (req, res) => {
    try {
      const value = decodeURIComponent(req.params.value);
      
      // Delete from custom entries
      await storage.deleteCustomEntry('bodyPart', value);
      
      // Update any existing videos that use this value
      const videos = await storage.getVideos();
      const videosToUpdate = videos.filter(video => 
        video.bodyPart && video.bodyPart.split(',').map(s => s.trim()).includes(value)
      );
      
      for (const video of videosToUpdate) {
        const updatedBodyParts = video.bodyPart
          .split(',')
          .map(s => s.trim())
          .filter(part => part !== value)
          .join(', ') || 'General';
        
        await storage.updateVideo(video.id, { bodyPart: updatedBodyParts });
      }
      
      res.json({ 
        message: "Body part deleted successfully", 
        videosUpdated: videosToUpdate.length 
      });
    } catch (error) {
      console.error('Error deleting body part:', error);
      res.status(500).json({ message: "Failed to delete body part" });
    }
  });

  app.delete("/api/video-options/secondaryMuscle/:value", async (req, res) => {
    try {
      const value = decodeURIComponent(req.params.value);
      
      // Delete from custom entries
      await storage.deleteCustomEntry('secondaryMuscle', value);
      
      // Update any existing videos that use this value
      const videos = await storage.getVideos();
      const videosToUpdate = videos.filter(video => 
        video.secondaryMuscle && video.secondaryMuscle.split(',').map(s => s.trim()).includes(value)
      );
      
      for (const video of videosToUpdate) {
        const updatedSecondaryMuscles = video.secondaryMuscle
          ? video.secondaryMuscle.split(',')
              .map(s => s.trim())
              .filter(muscle => muscle !== value)
              .join(', ') || ''
          : '';
        
        await storage.updateVideo(video.id, { secondaryMuscle: updatedSecondaryMuscles });
      }
      
      res.json({ 
        message: "Secondary muscle deleted successfully", 
        videosUpdated: videosToUpdate.length 
      });
    } catch (error) {
      console.error('Error deleting secondary muscle:', error);
      res.status(500).json({ message: "Failed to delete secondary muscle" });
    }
  });

  app.delete("/api/video-options/equipment/:value", async (req, res) => {
    try {
      const value = decodeURIComponent(req.params.value);
      
      // Delete from custom entries
      await storage.deleteCustomEntry('equipment', value);
      
      // Update any existing videos that use this value
      const videos = await storage.getVideos();
      const videosToUpdate = videos.filter(video => 
        video.equipment && video.equipment.split(',').map(s => s.trim()).includes(value)
      );
      
      for (const video of videosToUpdate) {
        const updatedEquipment = video.equipment
          .split(',')
          .map(s => s.trim())
          .filter(eq => eq !== value)
          .join(', ') || 'To be assigned';
        
        await storage.updateVideo(video.id, { equipment: updatedEquipment });
      }
      
      res.json({ 
        message: "Equipment deleted successfully", 
        videosUpdated: videosToUpdate.length 
      });
    } catch (error) {
      console.error('Error deleting equipment:', error);
      res.status(500).json({ message: "Failed to delete equipment" });
    }
  });

  // Update video metadata (inline editing)
  app.patch("/api/videos/:id", async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const { field, value } = req.body;
      
      console.log('PATCH video update:', { videoId, field, value, valueType: typeof value });
      
      // Get current video
      const video = await storage.getVideo(videoId);
      if (!video) {
        return res.status(404).json({ message: "Video not found" });
      }

      // Update the specific field
      const updates: any = {};
      if (field === 'bodyPart' || field === 'secondaryMuscle' || field === 'equipment' || field === 'title') {
        // Handle arrays (multi-select) by joining with commas
        if (Array.isArray(value)) {
          updates[field] = value.join(', ');
        } else {
          updates[field] = value;
        }

        // Save new custom entries to database for dropdown options
        if (field === 'bodyPart' || field === 'secondaryMuscle' || field === 'equipment') {
          const valueString = Array.isArray(value) ? value.join(', ') : value;
          const entries = valueString.split(',').map((item: string) => item.trim()).filter((item: string) => item.length > 0);
          
          const categoryMap = {
            'bodyPart': 'bodyPart',
            'secondaryMuscle': 'secondaryMuscle', 
            'equipment': 'equipment'
          };

          // Save each entry as a custom entry (duplicates are prevented by createCustomEntry)
          for (const entry of entries) {
            try {
              await storage.createCustomEntry({
                category: categoryMap[field as keyof typeof categoryMap],
                value: entry
              });
              console.log(`Saved custom entry: ${categoryMap[field as keyof typeof categoryMap]} = ${entry}`);
            } catch (error) {
              console.log(`Custom entry already exists or failed to save: ${entry}`);
            }
          }
        }
      } else {
        console.log('Invalid field received:', field);
        return res.status(400).json({ message: "Invalid field", receivedField: field });
      }

      console.log('Updates to apply:', updates);
      const updatedVideo = await storage.updateVideo(videoId, updates);
      if (!updatedVideo) {
        return res.status(500).json({ message: "Failed to update video" });
      }
      console.log('Video updated successfully:', updatedVideo.title);
      res.json(updatedVideo);
    } catch (error) {
      console.error('Error updating video:', error);
      res.status(500).json({ message: "Failed to update video" });
    }
  });

  // File integrity check endpoint
  app.post("/api/videos/verify-integrity", async (req, res) => {
    try {
      console.log('🔧 Manual file integrity check requested');
      const result = await verifyFileIntegrity();
      res.json({
        message: "File integrity check completed",
        ...result
      });
    } catch (error) {
      console.error('Error during file integrity check:', error);
      res.status(500).json({ message: "File integrity check failed", error: (error as Error).message });
    }
  });

  // Delete video with complete cleanup
  app.delete("/api/videos/:id", async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      console.log(`Starting deletion process for video ${videoId}`);
      
      // Get video details before deletion
      const video = await storage.getVideo(videoId);
      if (!video) {
        console.log(`Video ${videoId} not found in database`);
        return res.status(404).json({ message: "Video not found" });
      }

      console.log(`Found video ${videoId}: ${video.title}, starting cleanup`);

      // Delete all schedules associated with this video
      const { eq } = await import("drizzle-orm");
      const { schedules } = await import("../lib/shared/schema");
      const { db } = await import("./db");
      
      const scheduleDeleteResult = await db.delete(schedules).where(eq(schedules.videoId, videoId));
      console.log(`Deleted ${scheduleDeleteResult.rowCount || 0} schedules for video ${videoId}`);

      // Delete the video file (both local and Object Storage)
      const videoPath = path.join(process.cwd(), video.url.substring(1));
      
      // Try to delete from local storage first
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
        console.log(`Deleted video file from local storage: ${videoPath}`);
      } else {
        console.log(`Video file not found in local storage: ${videoPath}`);
      }
      
      // Also try to delete from Object Storage if the URL indicates it's stored there
      if (video.url.includes('/public-objects/uploads/')) {
        try {
          const { ObjectStorageService } = await import('./objectStorage');
          const objectStorageService = new ObjectStorageService();
          
          // Extract the file path from the URL
          const objectPath = video.url.replace('/public-objects/', '');
          const file = await objectStorageService.searchPublicObject(objectPath);
          
          if (file) {
            await file.delete();
            console.log(`Deleted video file from Object Storage: ${objectPath}`);
          } else {
            console.log(`Video file not found in Object Storage: ${objectPath}`);
          }
        } catch (objStorageError) {
          console.log(`Could not delete from Object Storage: ${objStorageError}`);
        }
      }

      // Delete the thumbnail file
      const thumbnailPath = path.join(process.cwd(), 'uploads', 'thumbnails', `thumbnail_${videoId}.jpg`);
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
        console.log(`Deleted thumbnail file: ${thumbnailPath}`);
      } else {
        console.log(`Thumbnail file not found: ${thumbnailPath}`);
      }

      // Delete video from database
      const deleted = await storage.deleteVideo(videoId);
      
      if (deleted) {
        console.log(`Successfully deleted video ${videoId}: ${video.title}`);
        res.json({ message: "Video and all associated data deleted successfully", deletedVideo: video.title });
      } else {
        console.log(`Failed to delete video ${videoId} from database`);
        res.status(500).json({ message: "Failed to delete video from database" });
      }
    } catch (error) {
      console.error(`Error deleting video ${req.params.id}:`, error);
      res.status(500).json({ message: "Failed to delete video", error: (error as Error).message });
    }
  });

  // Delete all schedules for a specific video
  app.delete("/api/schedules/video/:videoId", async (req, res) => {
    try {
      const videoId = parseInt(req.params.videoId);
      const { eq } = await import("drizzle-orm");
      
      const result = await db.delete(schedules).where(eq(schedules.videoId, videoId));
      console.log(`Deleted ${result.rowCount || 0} schedules for video ${videoId}`);
      
      res.json({ message: "Schedules deleted successfully", deletedCount: result.rowCount || 0 });
    } catch (error) {
      console.error('Error deleting schedules:', error);
      res.status(500).json({ message: "Failed to delete schedules" });
    }
  });

  // Schedules API endpoints
  app.get("/api/schedules", async (req, res) => {
    try {
      const date = req.query.date as string;
      const roomId = req.query.roomId as string;
      
      let schedules;
      if (date && roomId) {
        schedules = await storage.getSchedulesByRoomAndDate(parseInt(roomId), date);
      } else if (date) {
        schedules = await storage.getSchedulesByDate(date);
      } else if (roomId) {
        schedules = await storage.getSchedulesByRoom(parseInt(roomId));
      } else {
        schedules = await storage.getSchedules();
      }
      
      res.json(schedules);
    } catch (error) {
      console.error('Error fetching schedules:', error);
      res.status(500).json({ message: "Failed to fetch schedules" });
    }
  });

  app.post("/api/schedules", async (req, res) => {
    try {
      const scheduleData = req.body;
      console.log('Creating schedule:', scheduleData);
      const schedule = await storage.createSchedule(scheduleData);
      console.log('Schedule created successfully:', schedule);
      res.json(schedule);
    } catch (error) {
      console.error('Error creating schedule:', error);
      res.status(500).json({ message: "Failed to create schedule" });
    }
  });

  app.patch("/api/schedules/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      const schedule = await storage.updateSchedule(id, updates);
      res.json(schedule);
    } catch (error) {
      console.error('Error updating schedule:', error);
      res.status(500).json({ message: "Failed to update schedule" });
    }
  });

  app.delete("/api/schedules/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteSchedule(id);
      if (deleted) {
        res.json({ message: "Schedule deleted successfully" });
      } else {
        res.status(404).json({ message: "Schedule not found" });
      }
    } catch (error) {
      console.error('Error deleting schedule:', error);
      res.status(500).json({ message: "Failed to delete schedule" });
    }
  });

  app.get("/api/stats", async (req, res) => {
    try {
      const [rooms, videos, assignments] = await Promise.all([
        storage.getRooms(),
        storage.getVideos(),
        storage.getRoomAssignments()
      ]);

      const activeRooms = rooms.filter(room => room.isActive).length;
      const videosInUse = new Set(assignments.map(a => a.videoId)).size;

      res.json({
        activeRooms,
        videosInUse,
        totalVideos: videos.length,
        totalRooms: rooms.length
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Migration endpoint to move video from local storage to Object Storage
  app.post('/api/videos/migrate/:id', upload.none(), async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      console.log(`🔄 Starting migration for video ${videoId}`);
      
      // Get video record
      const video = await storage.getVideo(videoId);
      if (!video) {
        return res.status(404).json({ error: 'Video not found' });
      }
      
      // Check if already on Object Storage
      if (video.url.startsWith('/public-objects/')) {
        return res.json({ 
          success: true, 
          message: 'Video already on Object Storage',
          url: video.url 
        });
      }
      
      // Check if on local storage
      if (!video.url.startsWith('/uploads/')) {
        return res.status(400).json({ error: 'Video not on local storage' });
      }
      
      // Extract filename and construct local path
      const filename = video.url.replace('/uploads/', '');
      const localPath = path.join(uploadsDir, filename);
      
      if (!fs.existsSync(localPath)) {
        return res.status(404).json({ error: 'Local video file not found' });
      }
      
      // Read the video file
      console.log(`📂 Reading video file: ${filename}`);
      const videoBuffer = await fs.promises.readFile(localPath);
      console.log(`📏 File size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
      
      // Generate new Object Storage path
      const fileExtension = path.extname(filename);
      const fileId = Date.now() + '-' + Math.round(Math.random() * 1E6);
      const videoKey = `uploads/${fileId}${fileExtension}`;
      const publicObjectPath = `public/${videoKey}`;
      
      // Upload to Object Storage
      console.log(`☁️  Uploading to Object Storage: ${publicObjectPath}`);
      const { objectStorageClient } = await import('./objectStorage');
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
      const file = objectStorageClient.bucket(bucketId).file(publicObjectPath);
      await file.save(videoBuffer);
      
      const newUrl = `/public-objects/${videoKey}`;
      console.log(`✅ Uploaded successfully, new URL: ${newUrl}`);
      
      // Update video record
      const updatedVideo = await storage.updateVideo(videoId, { url: newUrl });
      console.log(`💾 Database updated for video ${videoId}`);
      
      res.json({ 
        success: true, 
        oldUrl: video.url,
        newUrl: newUrl,
        message: 'Video migrated to Object Storage successfully' 
      });
      
    } catch (error) {
      console.error(`❌ Migration failed for video ${req.params.id}:`, error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Duplicate detection endpoint for bulk uploads
  app.post('/api/videos/check-duplicates', upload.none(), async (req, res) => {
    try {
      const { filenames } = req.body;
      if (!Array.isArray(filenames)) {
        return res.status(400).json({ error: 'filenames must be an array' });
      }

      console.log(`🔍 Checking duplicates for ${filenames.length} files`);
      
      // Get all existing videos
      const existingVideos = await storage.getVideos();
      
      // Create a map of existing video titles (cleaned up for comparison)
      const existingTitles = new Set();
      existingVideos.forEach(video => {
        // Clean up title for comparison - remove common variations
        const cleanTitle = video.title
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/[()]/g, '')
          .replace(/\s*-\s*/g, ' ')
          .replace(/\s*_\s*/g, ' ');
        existingTitles.add(cleanTitle);
      });

      // Check each filename for duplicates
      const results = filenames.map(filename => {
        // Extract clean title from filename (remove extension and clean up)
        const title = filename
          .replace(/\.[^/.]+$/, '') // Remove extension
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/[()]/g, '')
          .replace(/\s*-\s*/g, ' ')
          .replace(/\s*_\s*/g, ' ');

        const isDuplicate = existingTitles.has(title);
        
        return {
          filename,
          title: filename.replace(/\.[^/.]+$/, ''), // Original title for display
          isDuplicate,
          reason: isDuplicate ? 'Video with similar title already exists' : null
        };
      });

      const duplicateCount = results.filter(r => r.isDuplicate).length;
      const newCount = results.length - duplicateCount;

      console.log(`✅ Duplicate check complete: ${duplicateCount} duplicates, ${newCount} new videos`);

      res.json({
        results,
        summary: {
          total: filenames.length,
          duplicates: duplicateCount,
          new: newCount
        }
      });

    } catch (error) {
      console.error('❌ Duplicate check failed:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

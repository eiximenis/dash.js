/*
 * The copyright in this software module is being made available under the BSD License, included below. This software module may be subject to other third party and/or contributor rights, including patent rights, and no such rights are granted under this license.
 * The whole software resulting from the execution of this software module together with its external dependent software modules from dash.js project may be subject to Orange and/or other third party rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2014, Orange
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * •  Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * •  Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * •  Neither the name of the Orange nor the names of its contributors may be used to endorse or promote products derived from this software module without specific prior written permission.
 *
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import ErrorHandler from '../streaming/utils/ErrorHandler';
import FactoryMaker from '../core/FactoryMaker.js';
import Debug from '../core/Debug';
import _DOMParser from '../streaming/utils/DOMParser.js';
import MetricsModel from '../streaming/models/MetricsModel.js';
import DashAdapter from '../dash/DashAdapter.js';
import {BASE64} from './lib/base64.js';
import KeySystemWidevine from '../streaming/protection/drm/KeySystemPlayReady.js';
import KeySystemPlayReady from '../streaming/protection/drm/KeySystemPlayReady.js';
import IsSegmentAvailableOnServerRule from './rules/scheduling/IsSegmentAvailableOnServerRule';

function MssParser() {
    let context = this.context;
    let log = Debug(context).getInstance().log;
    let domParser = _DOMParser(context).getInstance();
    let metricsModel = MetricsModel(context).getInstance();
    let ksWidevine = KeySystemWidevine(context).getInstance();
    let ksPlayReady = KeySystemPlayReady(context).getInstance();
    let isSegmentAvailableOnServerRule = IsSegmentAvailableOnServerRule(context).getInstance();
    let instance;
    
    var TIME_SCALE_100_NANOSECOND_UNIT = 10000000.0,
        samplingFrequencyIndex = {
            96000: 0x0,
            88200: 0x1,
            64000: 0x2,
            48000: 0x3,
            44100: 0x4,
            32000: 0x5,
            24000: 0x6,
            22050: 0x7,
            16000: 0x8,
            12000: 0x9,
            11025: 0xA,
            8000: 0xB,
            7350: 0xC
        },
        mimeTypeMap = {
            "video": "video/mp4",
            "audio": "audio/mp4",
            "text": "application/ttml+xml+mp4"
        },
        xmlDoc = null,
        baseURL = null,

        mapPeriod = function() {
            var period = {},
                adaptations = [],
                adaptation,
                smoothNode = domParser.getChildNode(xmlDoc, "SmoothStreamingMedia"),
                i;

            
            period.duration = (parseFloat(domParser.getAttributeValue(smoothNode, 'Duration')) === 0) ? Infinity : parseFloat(domParser.getAttributeValue(smoothNode, 'Duration')) / TIME_SCALE_100_NANOSECOND_UNIT;
            period.BaseURL = baseURL;

            // For each StreamIndex node, create an AdaptationSet element
            for (i = 0; i < smoothNode.childNodes.length; i++) {
                if (smoothNode.childNodes[i].nodeName === "StreamIndex") {
                    adaptation = mapAdaptationSet.call(this, smoothNode.childNodes[i]);
                    if (adaptation !== null) {
                        adaptations.push(adaptation);
                    }
                }
            }

            if (adaptations.length > 0) {
                period.AdaptationSet = (adaptations.length > 1) ? adaptations : adaptations[0];
            }
            period.AdaptationSet_asArray = adaptations;

            return period;
        },
        // Map MSS <Clip> element to a Period in MPD
        mapPeriodCSM = function() {
			var periods = [],
				period = {},
				adaptations = [],
				smoothNode = domParser.getChildNode(xmlDoc, "SmoothStreamingMedia"),
				durationCMS = 0,
				i,
				j,
				start = 0;

			smoothNode = smoothNode.getElementsByTagName("Clip");

			for(j = 0; j < smoothNode.length; j++) {
				period = {};
				adaptations = [];
                let url =  smoothNode[j].getAttribute("Url");
                if (url)  {
                    period.BaseURL = url.replace(".ism/Manifest", ".ism/");
                    period.BaseURL_asArray =[period.BaseURL];
                } 
                
                var clipBegin = parseFloat(smoothNode[j].getAttribute("ClipBegin"));
                
                // Adjust ClipBegin to first time of S
                
                
                var clipEnd = parseFloat(smoothNode[j].getAttribute("ClipEnd"));
				durationCMS = clipEnd - clipBegin;
                period.clipBegin = clipBegin;
                period.clipEnd = clipEnd; 
				period.duration = (durationCMS === 0) ? Infinity : (durationCMS / TIME_SCALE_100_NANOSECOND_UNIT);
                period.id = j;
				// For each StreamIndex node, create an AdaptationSet element
				for(i = 0; i < smoothNode[j].childNodes.length; i++) {
					if(smoothNode[j].childNodes[i].nodeName === "StreamIndex") {
						adaptations.push(mapAdaptationSet.call(this, smoothNode[j].childNodes[i], period.BaseURL.replace(".ism/Manifest", ".ism/")));
					}
				}

				period.AdaptationSet = (adaptations.length > 1) ? adaptations : adaptations[0];
				period.AdaptationSet_asArray = adaptations;

				//period.start = 0;//(parseFloat(smoothNode[j].getAttribute("ClipBegin"))/ TIME_SCALE_100_NANOSECOND_UNIT);

				periods.push(period);
                
                if (period.duration !== Infinity) {
                    adjustAllSegmentTimelines(period);
                    log('[MSSParser] -> Adjusted segments (S_asArray) durations');
                }
                
                
				//start += period.duration;
			}

			return periods;
		},
       
        
        adjustAllSegmentTimelines = function(period) {
            for (let aidx = 0; aidx < period.AdaptationSet_asArray.length; aidx++) {
                let adaptation = period.AdaptationSet_asArray[aidx];
                for (let ridx = 0; ridx < adaptation.Representation_asArray.length; ridx++) {
                    let representation = adaptation.Representation_asArray[ridx]; 
                    let S_asArray =  representation.SegmentTemplate.SegmentTimeline.S_asArray;
                    adjustSegmentTimeline(S_asArray, representation.SegmentTemplate.timescale, period);
                }
            }
        },
        
        adjustSegmentTimeline = function (S_asArray, timescale, period) {
            var begin = period.clipBegin;
            var unescaledPeriodDuration = period.duration * timescale;
            var total_d = 0;
            var current_t = begin;
            
            
            for (var sidx = 0; sidx <= S_asArray.length -1 ; sidx++) {
                if (sidx == 0) {
                    S_asArray[sidx].d = (S_asArray[sidx].t + S_asArray[sidx].d) -  begin;
                }
                
                
                S_asArray[sidx]._msst = S_asArray[sidx].t;
                S_asArray[sidx].t = total_d;
                // total_d +=  S_asArray[sidx].d;
                
                
                
                if (sidx == S_asArray.length - 1) {
                    let remaining = unescaledPeriodDuration- total_d;
                    if (remaining < 0) {
                        debugger;
                    }
                    S_asArray[sidx].d = remaining;
                }
                else {
                    total_d += S_asArray[sidx].d;
                    current_t += S_asArray[sidx].d;  
                }
            }
        },

        mapAdaptationSet = function(streamIndex, periodBaseUrl) {

            var adaptationSet = {},
                representations = [],
                representation,
                segmentTemplate = {},
                segments,
                qualityLevels = null,
                i;

            adaptationSet.id = domParser.getAttributeValue(streamIndex, "Name");
            adaptationSet.lang = domParser.getAttributeValue(streamIndex, "Language");
            adaptationSet.contentType = domParser.getAttributeValue(streamIndex, "Type");
            adaptationSet.mimeType = mimeTypeMap[adaptationSet.contentType];
            adaptationSet.maxWidth = domParser.getAttributeValue(streamIndex, "MaxWidth");
            adaptationSet.maxHeight = domParser.getAttributeValue(streamIndex, "MaxHeight");
            adaptationSet.BaseURL =  periodBaseUrl || baseURL;

            // Create a SegmentTemplate with a SegmentTimeline
            segmentTemplate = mapSegmentTemplate.call(this, streamIndex);
            qualityLevels = domParser.getChildNodes(streamIndex, "QualityLevel");
            // For each QualityLevel node, create a Representation element
            for (i = 0; i < qualityLevels.length; i++) {
                // Propagate BaseURL and mimeType
                qualityLevels[i].BaseURL = adaptationSet.BaseURL;
                qualityLevels[i].mimeType = adaptationSet.mimeType;

                // Set quality level id
                qualityLevels[i].Id = adaptationSet.id + "_" + domParser.getAttributeValue(qualityLevels[i], "Index");

                // Map Representation to QualityLevel
                representation = mapRepresentation.call(this, qualityLevels[i], streamIndex);

                if (representation !== null) {
                    // Copy SegmentTemplate into Representation
                    representation.SegmentTemplate = segmentTemplate;

                    representations.push(representation);
                }
            }

            if (representations.length === 0) {
                return null;
            }

            adaptationSet.Representation = (representations.length > 1) ? representations : representations[0];
            adaptationSet.Representation_asArray = representations;

            // Set SegmentTemplate
            adaptationSet.SegmentTemplate = segmentTemplate;

            segments = segmentTemplate.SegmentTimeline.S_asArray;
            
            /*
            // TODO EDU -> Review this
            metricsModel.addDVRInfo(adaptationSet.contentType, 0, null, {
                start: segments[0].t / segmentTemplate.timescale,
                end: (segments[segments.length - 1].t + segments[segments.length - 1].d)  / segmentTemplate.timescale
            });
            */

            return adaptationSet;
        },

        mapRepresentation = function(qualityLevel, streamIndex) {

            var representation = {},
                fourCCValue = null;

            representation.id = qualityLevel.Id;
            representation.bandwidth = parseInt(domParser.getAttributeValue(qualityLevel, "Bitrate"), 10);
            representation.mimeType = qualityLevel.mimeType;
            representation.width = parseInt(domParser.getAttributeValue(qualityLevel, "MaxWidth"), 10);
            representation.height = parseInt(domParser.getAttributeValue(qualityLevel, "MaxHeight"), 10);

            fourCCValue = domParser.getAttributeValue(qualityLevel, "FourCC");

            if (fourCCValue === null) {
                fourCCValue = domParser.getAttributeValue(streamIndex, "FourCC");
            }
            
            // If still not defined (optionnal for audio stream, see https://msdn.microsoft.com/en-us/library/ff728116%28v=vs.95%29.aspx),
            // then we consider the stream is an audio AAC stream
            if (fourCCValue === null || fourCCValue === "") {
                fourCCValue = "AAC";        
            }

            // Do not support AACH (TODO)
            if (fourCCValue.indexOf("AACH") >= 0) {
                return null;
            }

            // Get codecs value according to FourCC field
            if (fourCCValue === "H264" || fourCCValue === "AVC1") {
                representation.codecs = getH264Codec.call(this, qualityLevel);
            } else if (fourCCValue.indexOf("AAC") >= 0) {
                representation.codecs = getAACCodec.call(this, qualityLevel, fourCCValue);
                representation.audioSamplingRate = parseInt(domParser.getAttributeValue(qualityLevel, "SamplingRate"), 10);
                representation.audioChannels = parseInt(domParser.getAttributeValue(qualityLevel, "Channels"), 10);
            }

            representation.codecPrivateData = "" + domParser.getAttributeValue(qualityLevel, "CodecPrivateData");
            representation.BaseURL = qualityLevel.BaseURL;
            

            return representation;
        },

        getH264Codec = function(qualityLevel) {
            var codecPrivateData = domParser.getAttributeValue(qualityLevel, "CodecPrivateData").toString(),
                nalHeader,
                avcoti;


            // Extract from the CodecPrivateData field the hexadecimal representation of the following
            // three bytes in the sequence parameter set NAL unit.
            // => Find the SPS nal header
            nalHeader = /00000001[0-9]7/.exec(codecPrivateData);
            // => Find the 6 characters after the SPS nalHeader (if it exists)
            avcoti = nalHeader && nalHeader[0] ? (codecPrivateData.substr(codecPrivateData.indexOf(nalHeader[0]) + 10, 6)) : undefined;

            return "avc1." + avcoti;
        },

        getAACCodec = function(qualityLevel, fourCCValue) {
            var objectType = 0,
                codecPrivateData = domParser.getAttributeValue(qualityLevel, "CodecPrivateData").toString(),
                codecPrivateDataHex,
                samplingRate = parseInt(domParser.getAttributeValue(qualityLevel, "SamplingRate"), 10),
                arr16,
                indexFreq,
                extensionSamplingFrequencyIndex;

            //chrome problem, in implicit AAC HE definition, so when AACH is detected in FourCC
            //set objectType to 5 => strange, it should be 2
            if (fourCCValue === "AACH") {
                objectType = 0x05;
            }
            //if codecPrivateData is empty, build it :
            if (codecPrivateData === undefined || codecPrivateData === "") {
                objectType = 0x02; //AAC Main Low Complexity => object Type = 2
                indexFreq = samplingFrequencyIndex[samplingRate];
                if (fourCCValue === "AACH") {
                    // 4 bytes :     XXXXX         XXXX          XXXX             XXXX                  XXXXX      XXX   XXXXXXX
                    //           ' ObjectType' 'Freq Index' 'Channels value'   'Extens Sampl Freq'  'ObjectType'  'GAS' 'alignment = 0'
                    objectType = 0x05; // High Efficiency AAC Profile = object Type = 5 SBR
                    codecPrivateData = new Uint8Array(4);
                    extensionSamplingFrequencyIndex = samplingFrequencyIndex[samplingRate * 2]; // in HE AAC Extension Sampling frequence
                    // equals to SamplingRate*2
                    //Freq Index is present for 3 bits in the first byte, last bit is in the second
                    codecPrivateData[0] = (objectType << 3) | (indexFreq >> 1);
                    codecPrivateData[1] = (indexFreq << 7) | (qualityLevel.Channels << 3) | (extensionSamplingFrequencyIndex >> 1);
                    codecPrivateData[2] = (extensionSamplingFrequencyIndex << 7) | (0x02 << 2); // origin object type equals to 2 => AAC Main Low Complexity
                    codecPrivateData[3] = 0x0; //alignment bits

                    arr16 = new Uint16Array(2);
                    arr16[0] = (codecPrivateData[0] << 8) + codecPrivateData[1];
                    arr16[1] = (codecPrivateData[2] << 8) + codecPrivateData[3];
                    //convert decimal to hex value
                    codecPrivateDataHex = arr16[0].toString(16);
                    codecPrivateDataHex = arr16[0].toString(16) + arr16[1].toString(16);

                } else {
                    // 2 bytes :     XXXXX         XXXX          XXXX              XXX
                    //           ' ObjectType' 'Freq Index' 'Channels value'   'GAS = 000'
                    codecPrivateData = new Uint8Array(2);
                    //Freq Index is present for 3 bits in the first byte, last bit is in the second
                    codecPrivateData[0] = (objectType << 3) | (indexFreq >> 1);
                    codecPrivateData[1] = (indexFreq << 7) | (parseInt(domParser.getAttributeValue(qualityLevel, "Channels"), 10) << 3);
                    // put the 2 bytes in an 16 bits array
                    arr16 = new Uint16Array(1);
                    arr16[0] = (codecPrivateData[0] << 8) + codecPrivateData[1];
                    //convert decimal to hex value
                    codecPrivateDataHex = arr16[0].toString(16);
                }

                codecPrivateData = "" + codecPrivateDataHex;
                codecPrivateData = codecPrivateData.toUpperCase();
                qualityLevel.setAttribute("CodecPrivateData", codecPrivateData);
            } else if (objectType === 0) {
                objectType = (parseInt(codecPrivateData.substr(0, 2), 16) & 0xF8) >> 3;
            }

            return "mp4a.40." + objectType;
        },

        mapSegmentTemplate = function(streamIndex) {

            var segmentTemplate = {},
                mediaUrl;

            mediaUrl = domParser.getAttributeValue(streamIndex, "Url").replace('{bitrate}', '$Bandwidth$');
            mediaUrl = mediaUrl.replace('{start time}', '$Time$');

            segmentTemplate.media = mediaUrl;
            segmentTemplate.timescale = TIME_SCALE_100_NANOSECOND_UNIT;
            segmentTemplate.SegmentTimeline = mapSegmentTimeline.call(this, streamIndex);
            //segmentTemplate.presentationTimeOffset = segmentTemplate.SegmentTimeline.S_asArray[0].t;
                   
            return segmentTemplate;
        },

        mapSegmentTimeline = function(streamIndex) {

            var segmentTimeline = {},
                chunks = domParser.getChildNodes(streamIndex, "c"),
                segments = [],
                i,
                t, d,r,
                total_d;

            total_d = 0;
            let idx_segment = 0;
            for (i = 0; i < chunks.length; i++) {
                // Get time and duration attributes
                t = parseFloat(domParser.getAttributeValue(chunks[i], "t"));
                d = parseFloat(domParser.getAttributeValue(chunks[i], "d"));
                r = parseFloat(domParser.getAttributeValue(chunks[i], "r"));
                if (isNaN(r)) { r = 1;}


                // We need to 'r' segments for this chunk.
                // Even though DASHJS is ready to accept SegmentTimeline with
                // segments containing the @r attribute, we cannot use that
                // because MssFragmentController is not ready to handle SegmentTimeline
                // having @r attributes. So, it is safer to "unroll" all @r at this
                // point
                for (var r_idx = 0; r_idx < r; r_idx++) {
                    total_d += d;
                    if (((idx_segment === 0) && !t) || (r_idx > 0)) {
                        t = 0;
                    }

                    if (t) { console.log('UFO => t:' + t);}

                    if (idx_segment > 0) {
                        // Update previous segment duration if not defined
                        if (!segments[segments.length - 1].d) {
                            segments[segments.length - 1].d = t - segments[segments.length - 1].t;
                        }
                        // Set segment absolute timestamp if not set
                        if (!t) {
                            t = segments[segments.length - 1].t + segments[segments.length - 1].d;                         
                        }
                    }
                    // Create new segment
                    var segment = {
                        d: d,
                        t: t
                    }
                    segments.push(segment);
                    idx_segment++;
                }

            }

            segmentTimeline.S = segments;
            segmentTimeline.S_asArray = segments;
            segmentTimeline.total_d = total_d;
            return segmentTimeline;
        },

        /* @if PROTECTION=true */
        getKIDFromProtectionHeader = function(protectionHeader) {
            var prHeader,
                wrmHeader,
                xmlReader,
                KIDNode,
                KID;
               

            // Get PlayReady header as byte array (base64 decoded)
            prHeader = BASE64.decodeArray(protectionHeader.firstChild.data);

            // Get Right Management header (WRMHEADER) from PlayReady header
            wrmHeader = getWRMHeaderFromPRHeader(prHeader);

            // Convert from multi-byte to unicode
            wrmHeader = new Uint16Array(wrmHeader.buffer);

            // Convert to string
            wrmHeader = String.fromCharCode.apply(null, wrmHeader);

            // Parse <WRMHeader> to get KID field value
            xmlReader = (new DOMParser()).parseFromString(wrmHeader, "application/xml");
            KIDNode = xmlReader.querySelector("KID");

            if (KIDNode) {
                // Get KID (base64 decoded) as byte array
                KID = BASE64.decodeArray(KIDNode.textContent);
                // Convert UUID from little-endian to big-endian
                convertUuidEndianness(KID);
                return KID;
            }
        },

        getWRMHeaderFromPRHeader = function(prHeader) {
            var length,
                recordCount,
                recordType,
                recordLength,
                recordValue,
                i = 0;

            // Parse PlayReady header

            // Length - 32 bits (LE format)
            length = (prHeader[i + 3] << 24) + (prHeader[i + 2] << 16) + (prHeader[i + 1] << 8) + prHeader[i];
            i += 4;

            // Record count - 16 bits (LE format)
            recordCount = (prHeader[i + 1] << 8) + prHeader[i];
            i += 2;

            // Parse records
            while (i < prHeader.length) {
                // Record type - 16 bits (LE format)
                recordType = (prHeader[i + 1] << 8) + prHeader[i];
                i += 2;

                // Check if Rights Management header (record type = 0x01)
                if (recordType === 0x01) {

                    // Record length - 16 bits (LE format)
                    recordLength = (prHeader[i + 1] << 8) + prHeader[i];
                    i += 2;

                    // Record value => contains <WRMHEADER>
                    recordValue = new Uint8Array(recordLength);
                    recordValue.set(prHeader.subarray(i, i + recordLength));
                    return recordValue;
                }
            }

            return null;
        },

        convertUuidEndianness = function(uuid) {
            swapBytes(uuid, 0, 3);
            swapBytes(uuid, 1, 2);
            swapBytes(uuid, 4, 5);
            swapBytes(uuid, 6, 7);
        },

        swapBytes = function(bytes, pos1, pos2) {
            var temp = bytes[pos1];
            bytes[pos1] = bytes[pos2];
            bytes[pos2] = temp;
        },


        createPRContentProtection = function(protectionHeader) {

            var contentProtection = {},
                keySystem = ksPlayReady,
                pro;

            pro = {
                __text: protectionHeader.firstChild.data,
                __prefix: "mspr"
            };

            contentProtection.schemeIdUri = keySystem.schemeIdURI;
            contentProtection.value = keySystem.systemString;
            contentProtection.pro = pro;
            contentProtection.pro_asArray = pro;

            return contentProtection;
        },

        /*var createCENCContentProtection = function (protectionHeader) {

        var contentProtection = {};

        contentProtection.schemeIdUri = "urn:mpeg:dash:mp4protection:2011";
        contentProtection.value = "cenc";

        return contentProtection;
    };*/

        createWidevineContentProtection = function(protectionHeader) {

            var contentProtection = {},
                keySystem = ksWidevine;

            contentProtection.schemeIdUri = keySystem.schemeIdURI;
            contentProtection.value = keySystem.systemString;

            return contentProtection;
        },
        /* @endif */

        calcMediaPresentationDuration = function(smoothNode, isDynamic, dvrWindowLength) {
            if (isDynamic) {
                return dvrWindowLength;
            }
            else {
                return (parseFloat(domParser.getAttributeValue(smoothNode, 'Duration')) === 0) ? Infinity : parseFloat(domParser.getAttributeValue(smoothNode, 'Duration')) / TIME_SCALE_100_NANOSECOND_UNIT;
            }
            
        },

        processManifest = function(manifestLoadedTime) {
            var mpd = {},
                period,
                adaptations,
                contentProtection,
                contentProtections = [],
                smoothNode = domParser.getChildNode(xmlDoc, "SmoothStreamingMedia"),
                protection = domParser.getChildNode(smoothNode, 'Protection'),
                protectionHeader = null,
                KID,
                firstSegment,
                adaptationTimeOffset,
                i,
                dvrWindowLength,
                isDynamic;

            // Set mpd node properties
            mpd.profiles = "urn:mpeg:dash:profile:isoff-live:2011";
            mpd.type = Boolean(domParser.getAttributeValue(smoothNode, 'IsLive')) 
                ? "dynamic" 
                : (domParser.getChildNode(smoothNode, "Clip") ? "csm" : "static");

            
            isDynamic = mpd.type === "dynamic";
           
            dvrWindowLength =  parseFloat(domParser.getAttributeValue(smoothNode, 'DVRWindowLength'));
            mpd.timeShiftBufferDepth = dvrWindowLength / TIME_SCALE_100_NANOSECOND_UNIT;
            mpd.BaseURL = baseURL;
            //CCE
            mpd.minBufferTime = 12; // DEFAULT_MIN_BUFFER_TIME


            // Map period node to manifest root node
            if (mpd.type==="csm") {
                mpd.Period = mapPeriodCSM.call(this);
				mpd.BaseURL = mpd.Period[0].BaseURL;
				mpd.Period_asArray = mpd.Period;
				mpd.type = "static";
                mpd.hasClips = true;
            }
            else {
                mpd.Period = mapPeriod.call(this);
                mpd.Period_asArray = [mpd.Period];
                mpd.hasClips = false;
                if (isDynamic) {
                    mpd.Period.duration = dvrWindowLength /  TIME_SCALE_100_NANOSECOND_UNIT;
                    //mpd.minimumUpdatePeriod = 1;
                    log('[MssParser] LIVE -> Initializing IsSegmentAvailableOnServerRule rule');
                    isSegmentAvailableOnServerRule.init(getLastSegmentTimeFor(mpd.Period, "video"), "video");
                    isSegmentAvailableOnServerRule.init(getLastSegmentTimeFor(mpd.Period, "audio"), "audio");
                    // In case of live streams, set availabilityStartTime property according to DVRWindowLength
                    calcAvailabilityStartTime(mpd);
                }
            }
            
            mpd.mediaPresentationDuration = calcMediaPresentationDuration(smoothNode, isDynamic, dvrWindowLength);
            // Initialize period start time
            period = mpd.Period_asArray[0];
            period.start = 0;

            // ContentProtection node
            if (protection !== undefined) {
                /* @if PROTECTION=true */
                protectionHeader = domParser.getChildNode(protection, 'ProtectionHeader');

                // Some packagers put newlines into the ProtectionHeader base64 string, which is not good
                // because this cannot be correctly parsed. Let's just filter out any newlines found in there.
                protectionHeader.firstChild.data = protectionHeader.firstChild.data.replace(/\n|\r/g, "");

                // Get KID (in CENC format) from protection header
                KID = getKIDFromProtectionHeader(protectionHeader);

                // Create ContentProtection for PR
                contentProtection = createPRContentProtection.call(this, protectionHeader);
                contentProtection["cenc:default_KID"] = KID;
                contentProtections.push(contentProtection);

                // For chrome, create ContentProtection for Widevine as a CENC protection
                if (navigator.userAgent.indexOf("Chrome") >= 0) {
                    //contentProtections.push(createCENCContentProtection(manifest.Protection.ProtectionHeader));
                    contentProtection = createWidevineContentProtection.call(this, protectionHeader);
                    contentProtection["cenc:default_KID"] = KID;
                    contentProtections.push(contentProtection);
                }

                mpd.ContentProtection = (contentProtections.length > 1) ? contentProtections : contentProtections[0];
                mpd.ContentProtection_asArray = contentProtections;
                /* @endif */

                /* @if PROTECTION=false */
                /* @exec sendError('MediaPlayer.dependencies.ErrorHandler.prototype.MEDIA_ERR_ENCRYPTED','"protected content detected but protection module is not included."') */
                /* @exec reject('"[MssParser] Protected content detected but protection module is not included."') */
                /* @endif */
            }
            
            var currentStart = 0;
            for (var pidx = 0; pidx < mpd.Period_asArray.length; pidx++) {
                let cperiod = mpd.Period_asArray[pidx];
                let cadaptations = cperiod.AdaptationSet_asArray;
                for (i = 0; i < cadaptations.length; i += 1) {
                    // In case of VOD streams, check if start time is greater than 0.
                    // Therefore, set period start time to the higher adaptation start time
                    if (mpd.type === "static" && !mpd.hasClips) {
                        if (cadaptations[i].contentType !== 'text') {
                            firstSegment = cadaptations[i].SegmentTemplate.SegmentTimeline.S_asArray[0];
                            adaptationTimeOffset = parseFloat(firstSegment.t) / TIME_SCALE_100_NANOSECOND_UNIT;
                            cperiod.start = (cperiod.start === 0) ? adaptationTimeOffset : Math.max(cperiod.start, adaptationTimeOffset);
                        }
                    }
                    // Propagate content protection information into each adaptation
                    if (mpd.ContentProtection !== undefined) {
                        cadaptations[i].ContentProtection = mpd.ContentProtection;
                        cadaptations[i].ContentProtection_asArray = mpd.ContentProtection_asArray;
                    }
                }
                // In static manifests assume first period starts ALWAYS at 0 and next periods starts 
                // when the previous one finishes.
                
                /*
                if (mpd.type === "static") {           
                    cperiod.start = currentStart;
                    currentStart += cperiod.duration;
                }
                */
                
            }

            // Delete Content Protection under root mpd node
            delete mpd.ContentProtection;
            delete mpd.ContentProtection_asArray;
            
            mpd.isSmoothStreaming = true;
            
            return mpd;
        },
        calcAvailabilityStartTime = function(mpd) {    
            // mpd.availabilityStartTime = new Date(manifestLoadedTime.getTime() - (mpd.timeShiftBufferDepth * 1000));
            let period = mpd.Period;
            let availabilityStartTime = Infinity;
            for (let aidx = 0; aidx < period.AdaptationSet_asArray.length; aidx++) {
                let adaptation = period.AdaptationSet_asArray[aidx];
                let segmentTimeline =adaptation.SegmentTemplate.SegmentTimeline; 
                let segments = segmentTimeline.S_asArray;
                let first_t = segments[0].t / TIME_SCALE_100_NANOSECOND_UNIT;
                let now = new Date().getTime();
                let adaptAvailabilityStartTime = now - first_t * 1000;
                if (availabilityStartTime > adaptAvailabilityStartTime) {
                    availabilityStartTime = adaptAvailabilityStartTime;
                }
            }
            availabilityStartTime -= (mpd.timeShiftBufferDepth * 1000);
            mpd.availabilityStartTime = new Date(availabilityStartTime);
            log('[MssParser] -> Set Manifest AvailabilityStartTime to ' + mpd.availabilityStartTime);
        },

        getLastSegmentTimeFor = function(period, mediaType) {
            for (let aidx = 0; aidx < period.AdaptationSet_asArray.length; aidx++) {
                let adaptation = period.AdaptationSet_asArray[aidx];
                if (adaptation.contentType === mediaType) {
                    let segments = adaptation.SegmentTemplate.SegmentTimeline.S_asArray;
                    let last_t = segments[segments.length-1].t;
                    let last_d = segments[segments.length-1].d;
                    return (last_t + last_d) /  TIME_SCALE_100_NANOSECOND_UNIT;
                }
            }

        },

        internalParse = function(data, {baseUri}) {
            log("[MssParser] Doing parse.");

            var start = new Date(),
                xml = null,
                manifest = null,
                mss2dash = null;

            log("[MssParser] Converting from XML.");

            xmlDoc = domParser.createXmlTree(data);
            xml = new Date();

            if (xmlDoc === null) {
                ErrorHandler(context).getInstance().manifestError('[MssParser] parsing the manifest failed', 'parse', data);
                return null;
            }

            baseURL = baseUri;

            // Convert MSS manifest into DASH manifest
            manifest = processManifest.call(this, start);
            
            //mss2dash = new Date();
            //this.debug.log("mpd: " + JSON.stringify(manifest, null, '\t'));
            //this.debug.info("[MssParser]", "Parsing complete (xmlParser: " + (xml.getTime() - start.getTime()) + "ms, mss2dash: " + (mss2dash.getTime() - xml.getTime()) + "ms, total: " + ((new Date().getTime() - start.getTime()) / 1000) + "s)");
            //console.info("manifest",JSON.stringify(manifest) );
            
            //CCE: Evito la promise. 
            //return Q.when(manifest);
            return manifest;
        };

    instance = {
        parse: internalParse
    }
    
    return instance;
};

MssParser.__dashjs_factory_name = 'MssParser';
export default FactoryMaker.getClassFactory(MssParser);

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
import FactoryMaker from '../core/FactoryMaker.js';
import Events from '../core/events/Events';
import EventBus from '../core/EventBus';
import SegmentsGetter from '../dash/utils/SegmentsGetter';
import FragmentRequest from '../streaming/vo/FragmentRequest.js';
import Debug from '../core/Debug';
import {HTTPRequest} from '../streaming/vo/metrics/HTTPRequest';
import {replaceTokenForTemplate, getTimeBasedSegment, getSegmentByIndex} from '../dash/utils/SegmentsUtils';
import URLUtils from '../streaming/utils/URLUtils';
import Mp4Processor from './Mp4Processor';
import Mp4Track from './vo/Mp4Track';
import VideoModel from '../streaming/models/VideoModel';
import Capabilities from '../streaming/utils/Capabilities';

const SEGMENTS_UNAVAILABLE_ERROR_CODE = 1;

function MssHandler(config) {
    
    
    let instance,
        type,
        currentTime,
        earliestTime;
    
    let context = this.context;
    let log = Debug(context).getInstance().log;
    let logObjects = Debug(context).getInstance().logObjects;
    const urlUtils = URLUtils(context).getInstance();
    let streamProcessor, requestedTime, segmentsGetter, isDynamic, index;
    let eventBus = EventBus(context).getInstance();
    let segmentBaseLoader = config.segmentBaseLoader;
    let timelineConverter = config.timelineConverter;
    const baseURLController = config.baseURLController;
    let mp4Processor = Mp4Processor(context).create();
    let capabilities = Capabilities(context).getInstance();
    
    let dashMetrics = config.dashMetrics;
    let metricsModel = config.metricsModel;
    
    let root = config.parent;
    console.log(root);
    
    function setup() {
        index = -1;
        currentTime = 0;
        earliestTime = NaN;
        eventBus.on(Events.INITIALIZATION_LOADED, onInitializationLoaded, instance);
        eventBus.on(Events.SEGMENTS_LOADED, onSegmentsLoaded, instance);
    }
   
   
    function onInitializationLoaded(e) {
        var representation = e.representation;
        log("[MssHandler] onInitializationLoaded");
        if (!representation.segments) return;
        eventBus.trigger(Events.REPRESENTATION_UPDATED, {sender: this, representation: representation});        
    }
    
    function onSegmentsLoaded(e) {
        if (e.error || (type !== e.mediaType)) return;

        var fragments = e.segments;
        var representation = e.representation;
        var segments = [];
        var count = 0;

        var i,
            len,
            s,
            seg;

        for (i = 0, len = fragments.length; i < len; i++) {
            s = fragments[i];

            seg = getTimeBasedSegment(
                timelineConverter,
                isDynamic,
                representation,
                s.startTime,
                s.duration,
                s.timescale,
                s.media,
                s.mediaRange,
                count);

            segments.push(seg);
            seg = null;
            count++;
        }

        representation.segmentAvailabilityRange = {start: segments[0].presentationStartTime, end: segments[len - 1].presentationStartTime};
        representation.availableSegmentsNumber = len;

        onSegmentListUpdated(representation, segments);

        if (!representation.initialization) return;

        eventBus.trigger(Events.REPRESENTATION_UPDATED, {sender: this, representation: representation});
    }

    
    var getAudioChannels = function(adaptation, representation) {
        var channels = 1;

        if (adaptation.audioChannels) {
            channels = adaptation.audioChannels;
        } else if (representation.audioChannels) {
            channels = representation.audioChannels;
        }

        return channels;
    };
    
    var getAudioSamplingRate = function(adaptation, representation) {
        var samplingRate = 1;

        if (adaptation.audioSamplingRate) {
            samplingRate = adaptation.audioSamplingRate;
        } else {
            samplingRate = representation.audioSamplingRate;
        }

        return samplingRate;
    };
    // Generates initialization segment data from representation information
    // by using mp4lib library
    var getInitData = function(representation) {
        var manifest = representation.adaptation.period.mpd.manifest,
            adaptation,
            realAdaptation,
            realRepresentation,
            track,
            codec;

        if (representation.initData) {
            return representation.initData;
        }

        // Get required media information from manifest  to generate initialisation segment
        adaptation = representation.adaptation;
        realAdaptation = manifest.Period_asArray[adaptation.period.index].AdaptationSet_asArray[adaptation.index];
        realRepresentation = realAdaptation.Representation_asArray[representation.index];

        track = new Mp4Track();
        track.type = adaptation.type || 'und';
        track.trackId = adaptation.index + 1; // +1 since track_id shall start from '1'
        track.timescale = representation.timescale;
        track.duration = representation.adaptation.period.duration;
        track.codecs = realRepresentation.codecs;
        track.codecPrivateData = realRepresentation.codecPrivateData;
        track.bandwidth = realRepresentation.bandwidth;

        if (track.type !== 'text') {
            codec = realRepresentation.mimeType + ';codecs="' + realRepresentation.codecs + '"';
            if (!capabilities.supportsCodec(VideoModel(context).getInstance().getElement(), codec)) {
                throw {
                    name: "MEDIA_ERR_CODEC_UNSUPPORTED",
                    message: "Codec is not supported",
                    data: {
                        codec: codec
                    }
                };
            }
        }

        // DRM Protected Adaptation is detected
        if (realAdaptation.ContentProtection_asArray && (realAdaptation.ContentProtection_asArray.length > 0)) {
            track.contentProtection = realAdaptation.ContentProtection_asArray;
        }

        // Video related informations
        track.width = realRepresentation.width || realAdaptation.maxWidth;
        track.height = realRepresentation.height || realAdaptation.maxHeight;

        // Audio related informations
        track.language = realAdaptation.lang ? realAdaptation.lang : 'und';

        track.channels = getAudioChannels(realAdaptation, realRepresentation);
        track.samplingRate = getAudioSamplingRate(realAdaptation, realRepresentation);

        representation.initData = mp4Processor.generateInitSegment([track]);
        
        return representation.initData;
    };
    
    //CCE: Modified!!
    //var rslt = MediaPlayer.utils.copyMethods(Dash.dependencies.DashHandler);
    
    function getStreamProcessor() {
        return streamProcessor;
    }
    
    
    function initialize (StreamProcessor) {
        streamProcessor = StreamProcessor;
        type = streamProcessor.getType();
        isDynamic = streamProcessor.isDynamic();
        segmentsGetter = SegmentsGetter(context).create(config, isDynamic);
    }
    
    //CCE:Added!
    function updateSegmentList(representation) {

        if (!representation) {
            throw new Error('no representation');
        }

        representation.segments = null;

        updateSegments(representation);

        return representation;
    }
    
    //CCE:Added!
    function onSegmentListUpdated(representation, segments) {        
        representation.segments = segments;

        if (segments && segments.length > 0) {
            earliestTime = isNaN(earliestTime) ? segments[0].presentationStartTime : Math.min(segments[0].presentationStartTime,  earliestTime);
        }

        if (isDynamic && isNaN(timelineConverter.getExpectedLiveEdge())) {
            let lastIdx = segments.length - 1;
            let lastSegment = segments[lastIdx];
            let liveEdge = lastSegment.presentationStartTime;
            let metrics = metricsModel.getMetricsFor('stream');
            // the last segment is supposed to be a live edge
            timelineConverter.setExpectedLiveEdge(liveEdge);
            metricsModel.updateManifestUpdateInfo(dashMetrics.getCurrentManifestUpdate(metrics), {presentationStartTime: liveEdge});
        }
    }
    
    //CCE:Added!
    function updateSegments(representation) {
        return segmentsGetter.getSegments(representation, requestedTime, index, onSegmentListUpdated);
    }
    
    function updateRepresentation(representation, keepIdx) {
        var hasInitialization = representation.initialization;
        var hasSegments = representation.segmentInfoType !== 'BaseURL' && representation.segmentInfoType !== 'SegmentBase';
        var error;
        
        //CCE: Modified!
        if (hasInitialization == null)
            hasInitialization = true;
        
        if (!representation.segmentDuration && !representation.segments) {
            updateSegmentList(representation);
        }

        representation.segmentAvailabilityRange = null;
        representation.segmentAvailabilityRange = timelineConverter.calcSegmentAvailabilityRange(representation, isDynamic);
        
        if (isDynamic && representation.segmentAvailabilityRange.end < representation.segmentAvailabilityRange.start) {
            representation.segmentAvailabilityRange.end = Infinity;
        }


        if ((representation.segmentAvailabilityRange.end < representation.segmentAvailabilityRange.start) && !representation.useCalculatedLiveEdgeTime) {
            error = new Error(SEGMENTS_UNAVAILABLE_ERROR_CODE, 'no segments are available yet', {availabilityDelay: representation.segmentAvailabilityRange.start - representation.segmentAvailabilityRange.end});
            eventBus.trigger(Events.REPRESENTATION_UPDATED, {sender: this, representation: representation, error: error});
            return;
        }

        if (!keepIdx) index = -1;
        
        if (representation.segmentDuration) {
            updateSegmentList(representation);
        }
        
        if (!hasInitialization) {
           segmentBaseLoader.loadInitialization(representation);
        }
        //hasInitialization = false;
        
        if (!hasSegments) {
            segmentBaseLoader.loadSegments(representation, type, representation.indexRange);
        }

        if (hasInitialization && hasSegments) {
            eventBus.trigger(Events.REPRESENTATION_UPDATED, {sender: this, representation: representation});
        }
        eventBus.trigger(Events.REPRESENTATION_UPDATED, {sender: this, representation: representation});
    };
    

    function generateInitRequest(representation, mediaType) {
        var period = null,
            self = this,
            presentationStartTime = null,
            request = null,
            deferred = null;

        if (!representation) {
            throw new Error("[MssHandler] getInitRequest(): representation is undefined");
        }

        period = representation.adaptation.period;
        presentationStartTime = period.start;
        request = new FragmentRequest();
        request.streamType = representation.adaptation.type;
        
        request.type = HTTPRequest.INIT_SEGMENT_TYPE;
        // In MSS there are not really request to init segment. We need to build it by ourselves
        request.url = null;        
        request.mediaType = mediaType;
        request.range = representation.range;
        presentationStartTime = period.start;
        request.availabilityStartTime = timelineConverter.calcAvailabilityStartTimeFromPresentationTime(presentationStartTime, representation.adaptation.period.mpd, isDynamic);
        request.availabilityEndTime = timelineConverter.calcAvailabilityEndTimeFromPresentationTime(presentationStartTime + period.duration, period.mpd, isDynamic);
        request.quality = representation.index;
        request.mediaInfo = streamProcessor.getMediaInfo();
        request.mssData = getInitData(representation);
        return request;
    };
    
    
    function getInitRequest(representation) {
        var request;

        if (!representation) return null;
        
        logObjects("[MssHandler] generating init request for representation: ", representation);
        request = generateInitRequest(representation, type);
        return request;
    }    

    function isMediaFinished(representation) {
        var period = representation.adaptation.period;
        var segmentInfoType = representation.segmentInfoType;

        var isFinished = false;

        var sDuration,
            seg,
            fTime;

        if (index < 0) {
            isFinished = false;
        } else if (isDynamic || index < representation.availableSegmentsNumber) {
            seg = getSegmentByIndex(index, representation);

            if (seg) {
                fTime = seg.presentationStartTime - period.start;
                sDuration = representation.adaptation.period.duration;
                log(representation.segmentInfoType + ': ' + fTime + ' / ' + sDuration);
                logObjects(seg);
                isFinished = segmentInfoType === 'SegmentTimeline' && isDynamic ? false : (fTime >= sDuration);
            }
        } else {
            isFinished = true;
        }

        return isFinished;
    }    

     function getIFrameRequest(request){

        if (request && request.url && (request.streamType === "video" || request.streamType === "audio")) {
            request.url = request.url.replace('Fragments','KeyFrames');
        }

        return request;
    };
    
    
    function unescapeDollarsInTemplate(url) {
        return url.split('$$').join('$');
    }
    

    function setRequestUrl(request, destination, representation) {
        var baseURL = baseURLController.resolve(representation.path);
        var url;
        var serviceLocation;

        if (!baseURL || (destination === baseURL.url) || (!urlUtils.isRelative(destination))) {
            url = destination;
        } else {
            url = baseURL.url;
            serviceLocation = baseURL.serviceLocation;

            if (destination) {
                url += destination;
            }
        }

        if (urlUtils.isRelative(url)) {
            return false;
        }

        request.url = url;
        request.serviceLocation = serviceLocation;

        return true;
    }    
    
    function getIndexForSegments(time, representation, timeThreshold) {
        var segments = representation.segments;
        var ln = segments ? segments.length : null;

        var idx = -1;
        var epsilon,
            frag,
            ft,
            fd,
            i;

        if (segments && ln > 0) {
            for (i = 0; i < ln; i++) {
                frag = segments[i];
                ft = frag.presentationStartTime;
                fd = frag.duration;
                epsilon = (timeThreshold === undefined || timeThreshold === null) ? fd / 2 : timeThreshold;
                if ((time + epsilon) >= ft &&
                    (time - epsilon) < (ft + fd)) {
                    idx = frag.availabilityIdx;
                    break;
                }
            }
        }

        return idx;
    }    
    
    function getRequestForSegment(segment) {
        if (segment === null || segment === undefined) {
            return null;
        }

        var request = new FragmentRequest();
        var representation = segment.representation;
        var bandwidth = representation.adaptation.period.mpd.manifest.Period_asArray[representation.adaptation.period.index].
            AdaptationSet_asArray[representation.adaptation.index].Representation_asArray[representation.index].bandwidth;
        var url = segment.media;
        url = replaceTokenForTemplate(url, 'Bandwidth', bandwidth);
        url = unescapeDollarsInTemplate(url);

        request.mediaType = type;
        request.type = HTTPRequest.MEDIA_SEGMENT_TYPE;
        request.range = segment.mediaRange;
        request.startTime = segment.presentationStartTime;
        request.duration = segment.duration;
        request.timescale = representation.timescale;
        request.availabilityStartTime = segment.availabilityStartTime;
        request.availabilityEndTime = segment.availabilityEndTime;
        request.wallStartTime = segment.wallStartTime;
        request.quality = representation.index;
        request.index = segment.availabilityIdx;
        request.mediaInfo = streamProcessor.getMediaInfo();
        request.adaptationIndex = representation.adaptation.index;

        if (setRequestUrl(request, url, representation)) {
            logObjects('[MssHandler] getRequestForSegment. Segment:',  segment);
            logObjects('[MssHandler] getRequestForSegment. Request:',  request);
            return request;
        }
    }
    
    
    function generateSegmentRequestForTime() {
        log('[MSSHandler] generateSegmentRequestForTime - und');
    }
    
    function getSegmentRequestForTime(representation, time, options) {
        var request,
            segment,
            finished;

        var idx = index;

        var keepIdx = options ? options.keepIdx : false;
        var timeThreshold = options ? options.timeThreshold : null;
        var ignoreIsFinished = (options && options.ignoreIsFinished) ? true : false;

        if (!representation) {
            return null;
        }

        if (requestedTime !== time) { // When playing at live edge with 0 delay we may loop back with same time and index until it is available. Reduces verboseness of logs.
            requestedTime = time;
            log('Getting the request for ' + type + ' time : ' + time);
        }

        index = getIndexForSegments(time, representation, timeThreshold);
        //Index may be -1 if getSegments needs to update.  So after getSegments is called and updated then try to get index again.
        updateSegments(representation);
        if (index < 0) {
            index = getIndexForSegments(time, representation, timeThreshold);
        }

        if (index > 0) {
            log('Index for ' + type + ' time ' + time + ' is ' + index );
        }

        finished = !ignoreIsFinished ? isMediaFinished(representation) : false;
        
        if (finished) {
            request = new FragmentRequest();
            request.action = FragmentRequest.ACTION_COMPLETE;
            request.index = index;
            request.mediaType = type;
            request.mediaInfo = streamProcessor.getMediaInfo();
            log('Signal complete.', request);

        } else {
            segment = getSegmentByIndex(index, representation);
            request = getRequestForSegment(segment);
        }

        if (keepIdx && idx >= 0) {
            index = representation.segmentInfoType === 'SegmentTimeline' && isDynamic ? index : idx;
        }

        return request;
    }

    
    function getNextSegmentRequest(representation) {
        var request,
            segment,
            finished;

        if (!representation || index === -1) {
            return null;
        }

        requestedTime = null;
        index++;

        log('[MssHandler] Getting the next request at index: ' + index);

        finished = isMediaFinished(representation);
        if (finished) {
            request = new FragmentRequest();
            request.action = FragmentRequest.ACTION_COMPLETE;
            request.index = index;
            request.mediaType = type;
            request.mediaInfo = streamProcessor.getMediaInfo();
            log('[MssHandler] Signal complete.');
        } else {
            updateSegments(representation);
            segment = getSegmentByIndex(index, representation);
            request = getRequestForSegment(segment);
            if (!segment && isDynamic) {
                /*
                 Sometimes when playing dynamic streams with 0 fragment delay at live edge we ask for
                 an index before it is available so we decrement index back and send null request
                 which triggers the validate loop to rerun and the next time the segment should be
                 available.
                 */
                index-- ;
            }
        }

        return request;
    }
    function setCurrentTime(value) {
         currentTime = value;
    }
    
    function getCurrentTime() {
        return currentTime;
    }
    
    function getCurrentIndex() {
        log('[MSSHandler] getCurrentIndex - und');
    }
    
    function getEarliestTime() {
        return earliestTime;
    }
    
    function reset() {
        earliestTime = NaN;
    }

    instance = {
        initialize: initialize,
        getStreamProcessor: getStreamProcessor,
        getInitRequest: getInitRequest,
        getSegmentRequestForTime: getSegmentRequestForTime,
        getNextSegmentRequest: getNextSegmentRequest,
        generateSegmentRequestForTime: generateSegmentRequestForTime,
        updateRepresentation: updateRepresentation,
        setCurrentTime: setCurrentTime,
        getCurrentTime: getCurrentTime,
        getCurrentIndex: getCurrentIndex,
        getEarliestTime: getEarliestTime,
        reset: reset
    };
    
    setup();
    
    return instance;
};

MssHandler.__dashjs_factory_name = 'MssHandler';
export default FactoryMaker.getClassFactory(MssHandler);
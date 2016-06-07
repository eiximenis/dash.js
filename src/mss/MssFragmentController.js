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
import Debug from '../core/Debug';
import EventBus from '../core/EventBus';
import Events from '../core/events/Events';
import FragmentModel from '../streaming/models/FragmentModel';
import ManifestModel from '../streaming/models/ManifestModel';
import DashManifestModel from '../dash/models/DashManifestModel';
import MetricsModel from '../streaming/models/MetricsModel';
import mp4lib from './mp4lib/mp4lib.js';
import DataChunk from '../streaming/vo/DataChunk';
import {HTTPRequest} from '../streaming/vo/metrics/HTTPRequest';


function MssFragmentController() {

    let fragmentModels;
    let context = this.context;
    let log = Debug(context).getInstance().log;
    let eventBus = EventBus(context).getInstance();
    let manifestModel = ManifestModel(context).getInstance();
    let dashManifestModel = DashManifestModel(context).getInstance();
    let metricsModel = MetricsModel(context).getInstance();
    let fixDuration  = false;
    
    function setup() {
        fragmentModels = [];
        eventBus.on(Events.FRAGMENT_LOADING_COMPLETED, onFragmentLoadingCompleted, instance);
    }

    var processTfrf = function(tfrf, tfdt, adaptation) {
            var manifest = manifestModel.getValue(),
                segmentsUpdated = false,
                // Get adaptation's segment timeline (always a SegmentTimeline in Smooth Streaming use case)
                segments = adaptation.SegmentTemplate.SegmentTimeline.S,
                entries = tfrf.entry,
                fragment_absolute_time = 0,
                fragment_duration = 0,
                segment = null,
                t = 0,
                i = 0,
                j = 0,
                segmentId = -1,
                availabilityStartTime = null;

            // Go through tfrf entries
            while (i < entries.length) {
                fragment_absolute_time = entries[i].fragment_absolute_time;
                fragment_duration = entries[i].fragment_duration;

                // Get timestamp of the last segment
                segment = segments[segments.length - 1];
                t = segment.t;

                if (fragment_absolute_time > t) {
                    log("[MssFragmentController] Add new segment - t = " + (fragment_absolute_time / 10000000.0));
                    segments.push({
                        t: fragment_absolute_time,
                        d: fragment_duration
                    });
                    segmentsUpdated = true;
                }

                i += 1;
            }

            for (j = segments.length - 1; j >= 0; j -= 1) {
                if (segments[j].t === tfdt.baseMediaDecodeTime) {
                    segmentId = j;
                    break;
                }
            }

            if (segmentId >= 0) {
                for (i = 0; i < entries.length; i += 1) {
                    if (segmentId + i < segments.length) {
                        t = segments[segmentId + i].t;
                        if ((t + segments[segmentId + i].d) != entries[i].fragment_absolute_time) {
                            segments[segmentId + i].t = entries[i].fragment_absolute_time;
                            segments[segmentId + i].d = entries[i].fragment_duration;
                            log("[MssFragmentController] Correct tfrf time  = " + entries[i].fragment_absolute_time + "and duration = " + entries[i].fragment_duration + "! ********");
                            segmentsUpdated = true;
                        }
                    }
                }
            }

            // In case we have added some segments, we also check if some out of date segments
            // may not been removed
            if (segmentsUpdated && manifest.timeShiftBufferDepth && (manifest.timeShiftBufferDepth > 0)) {

                // Get timestamp of the last segment
                segment = segments[segments.length - 1];
                t = segment.t;

                // Determine the segments' availability start time
                availabilityStartTime = t - (manifest.timeShiftBufferDepth * 10000000);

                // Remove segments prior to availability start time
                segment = segments[0];
                while (segment.t < availabilityStartTime) {
                    log("[MssFragmentController] Remove segment  - t = " + (segment.t / 10000000.0));
                    segments.splice(0, 1);
                    segment = segments[0];
                }
                metricsModel.addDVRInfo(adaptation.type, 0, null, {
                    start: segments[0].t / adaptation.SegmentTemplate.timescale,
                    end: (segments[segments.length - 1].t + segments[segments.length - 1].d) / adaptation.SegmentTemplate.timescale
                });
            }
        },

        convertFragment = function(data, request, adaptation) {
            log('[MssFragmentController] converting fragment.');
            let periodIndex = 0;
            var i = 0,
                // Get track id corresponding to adaptation set
                manifest = manifestModel.getValue(),
                trackId = manifest ? dashManifestModel.getIndexForAdaptation(adaptation, manifest, periodIndex) + 1 : -1, // +1 since track_id shall start from '1'
                // Create new fragment
                fragment = mp4lib.deserialize(data),
                moof = null,
                mdat = null,
                traf = null,
                trun = null,
                tfhd = null,
                saio = null,
                sepiff = null,
                saiz = null,
                tfdt = null,
                tfrf = null,
                sizedifferent = false,
                pos = -1,
                fragment_size = 0,
                moofPosInFragment = 0,
                trafPosInMoof = 0,
                sencPosInTraf = 0,
                new_data = null;

            if (!fragment) {
                return null;
            }

            // Get references en boxes
            moof = fragment.getBoxByType("moof");
            mdat = fragment.getBoxByType("mdat");
            traf = moof.getBoxByType("traf");
            trun = traf.getBoxByType("trun");
            tfhd = traf.getBoxByType("tfhd");

            // If protected content (sepiff box)
            // => convert it into a senc box
            // => create saio and saiz boxes (if not already present)
            sepiff = traf.getBoxByType("sepiff");
            if (sepiff !== null) {
                sepiff.boxtype = "senc";
                sepiff.extended_type = undefined;

                saio = traf.getBoxByType("saio");              
                if (saio === null) {
                    // Create Sample Auxiliary Information Offsets Box box (saio)
                    saio = new mp4lib.boxes.SampleAuxiliaryInformationOffsetsBox();
                    saio.version = 0;
                    saio.flags = 0;
                    saio.entry_count = 1;
                    saio.offset = [];

                    saiz = new mp4lib.boxes.SampleAuxiliaryInformationSizesBox();
                    saiz.version = 0;
                    saiz.flags = 0;
                    saiz.sample_count = sepiff.sample_count;
                    saiz.default_sample_info_size = 0;

                    saiz.sample_info_size = [];

                    // get for each sample_info the size
                    if (sepiff.flags & 2) {
                        for (i = 0; i < sepiff.sample_count; i += 1) {
                            saiz.sample_info_size[i] = 8 + (sepiff.entry[i].NumberOfEntries * 6) + 2;
                            //8 (Init vector size) + NumberOfEntries*(clear (2) +crypted (4))+ 2 (numberofEntries size (2))
                            if (i > 0) {
                                if (saiz.sample_info_size[i] !== saiz.sample_info_size[i - 1]) {
                                    sizedifferent = true;
                                }
                            }
                        }

                        //all the samples have the same size
                        //set default size and remove the table.
                        if (sizedifferent === false) {
                            saiz.default_sample_info_size = saiz.sample_info_size[0];
                            saiz.sample_info_size = [];
                        }
                    } else {
                        //if flags === 0 (ex: audio data), default sample size = Init Vector size (8)
                        saiz.default_sample_info_size = 8;
                    }

                    //add saio and saiz box
                    traf.boxes.push(saiz);
                    traf.boxes.push(saio);
                }
            }

            // Update tfhd.track_ID field
            tfhd.track_ID = trackId;

            // Process tfxd boxes
            // This box provide absolute timestamp but we take the segment start time for tfdt
            traf.removeBoxByType("tfxd");

            // Create and add tfdt box
            tfdt = traf.getBoxByType("tfdt");
            if (tfdt === null) {
                tfdt = new mp4lib.boxes.TrackFragmentBaseMediaDecodeTimeBox();
                tfdt.version = 1;
                tfdt.flags = 0;
                tfdt.baseMediaDecodeTime = Math.floor(request.startTime * request.timescale);
                // Insert tfdt box just after the tfhd box (therefore before the trun box)
                pos = traf.getBoxIndexByType("tfhd");
                traf.boxes.splice(pos + 1, 0, tfdt);
            }

            // Process tfrf box
            tfrf = traf.getBoxesByType("tfrf");
            if (tfrf.length !== 0) {
                for (i = 0; i < tfrf.length; i += 1) {
                    processTfrf(tfrf[i], tfdt, adaptation);
                    traf.removeBoxByType("tfrf");
                }
            }

            // Before determining new size of the converted fragment we update some box flags related to data offset
            tfhd.flags &= 0xFFFFFE; // set tfhd.base-data-offset-present to false
            tfhd.flags |= 0x020000; // set tfhd.default-base-is-moof to true
            trun.flags |= 0x000001; // set trun.data-offset-present to true
            trun.data_offset = 0; // Set a default value for trun.data_offset

            //in trickMode, we have to modify sample duration for audio and video
            if (fixDuration && trun.samples_table.length === 1) {
                var fullDuration = request.duration * request.timescale,
                    concatDuration = 0,
                    mdatData = mdat.data,
                    sampleDuration;

                //if sample_duration is not defined, search duration in tfhd box
                if (trun.samples_table[0].sample_duration === undefined) {
                    sampleDuration = tfhd.default_sample_duration;
                }else{
                    sampleDuration = trun.samples_table[0].sample_duration;
                }
                //we have to duplicate the sample from KeyFrame request to be accepted by decoder.
                //all the samples have to have a duration equals to request.duration * request.timescale               
                var trunEntries = Math.floor(fullDuration / sampleDuration);
                
                for (i = 0; i < (trunEntries - 1); i++) {
                    trun.samples_table.push({
                        sample_duration: trun.samples_table[0].sample_duration,
                        sample_size: trun.samples_table[0].sample_size,
                        sample_composition_time_offset: trun.samples_table[0].sample_composition_time_offset,
                        sample_flags: trun.samples_table[0].sample_flags
                    });
                }

                if(trun.samples_table[0].sample_duration !== undefined){
                    for (i = 0; i < trun.samples_table.length; i++) {
                        concatDuration += trun.samples_table[i].sample_duration;
                    }

                    if (concatDuration > fullDuration) {
                        trun.samples_table[trun.samples_table.length - 1].sample_duration -= (concatDuration - fullDuration);
                    } else {
                        trun.samples_table[trun.samples_table.length - 1].sample_duration += (fullDuration - concatDuration);
                    }
                }

                //update sepiff and saiz boxes with replicated datas
                if (sepiff !== null) {
                    //if sepiff box has all datas for the complete fragments, delete thoses informations
                    if (sepiff.sample_count > 1) {
                        sepiff.entry = sepiff.entry.slice(0, 1);
                    }
                    //replicate the first entry
                    for (i = 0; i < (trunEntries - 1); i += 1) {
                        sepiff.entry.push(sepiff.entry[0]);
                    }

                    //if saio box was defined in the mp4 stream, saiz was also defined : get it now!
                    if (saiz === null) {
                        saiz = traf.getBoxByType("saiz");
                    }
                
                    if (saiz.default_sample_info_size === 0) {
                        //as for sepiff box....
                        if (saiz.sample_count > 1) {
                            saiz.sample_info_size = saiz.sample_info_size.slice(0, 1);
                        }
                        for (i = 0; i < (trunEntries-1); i += 1) {
                            saiz.sample_info_size.push(saiz.sample_info_size[0]);
                        }
                    }

                    sepiff.sample_count = sepiff.entry.length;
                    saiz.sample_count = sepiff.entry.length;
                }
                
                //in the same way, we have to duplicate mdat.data.
                trun.sample_count = trun.samples_table.length;
                mdat.data = new Uint8Array(mdatData.length * trun.sample_count);
                for (i = 0; i < trun.sample_count; i += 1) {
                    mdat.data.set(mdatData, mdatData.length * i);
                }
            }

            // Determine new size of the converted fragment
            // and allocate new data buffer
            fragment_size = fragment.getLength();

            // updata trun.data_offset field = offset of first data byte (inside mdat box)
            trun.data_offset = fragment_size - mdat.size + 8; // 8 = 'size' + 'type' mdat fields length

            // Update saio box offset field according to new senc box offset
            if (sepiff !== null) {
                moofPosInFragment = fragment.getBoxOffsetByType("moof");
                trafPosInMoof = moof.getBoxOffsetByType("traf");
                sencPosInTraf = traf.getBoxOffsetByType("senc");
                // set offset from begin fragment to the first IV in senc box
                saio.offset[0] = moofPosInFragment + trafPosInMoof + sencPosInTraf + 16; // box header (12) + sampleCount (4)
            }

            new_data = mp4lib.serialize(fragment);

            return new_data;
        };
    
    function getModel(scheduleController) {
        if (!scheduleController) return null;
        // Wrap the buffer controller into model and store it to track the loading state and execute the requests
        var model = findModel(scheduleController);

        if (!model) {
            model = FragmentModel(context).create({metricsModel: metricsModel});
            model.setScheduleController(scheduleController);
            fragmentModels.push(model);
        }

        return model;
    };
    
    function detachModel(model) {
        var idx = fragmentModels.indexOf(model);
        // If we have the model for the given buffer just remove it from array
        if (idx > -1) {
            fragmentModels.splice(idx, 1);
        }
    }
    
    function findModel(scheduleController) {
        var ln = fragmentModels.length;
        // We expect one-to-one relation between FragmentModel and context,
        // so just compare the given context object with the one that stored in the model to find the model for it
        for (var i = 0; i < ln; i++) {
            if (fragmentModels[i].getScheduleController() == scheduleController) {
                return fragmentModels[i];
            }
        }

        return null;
    }
    
    function createDataChunk(bytes, request, streamId) {
        var chunk = new DataChunk();

        chunk.streamId = streamId;
        chunk.mediaInfo = request.mediaInfo;
        chunk.segmentType = request.type;
        chunk.start = request.startTime;
        chunk.duration = request.duration;
        chunk.end = chunk.start + chunk.duration;
        chunk.bytes = bytes;
        chunk.index = request.index;
        chunk.quality = request.quality;

        return chunk;
    }


    function onFragmentLoadingCompleted(e) {
        let scheduleController = e.sender.getScheduleController();
        if (!findModel(scheduleController)) return;

        let request = e.request;
        let bytes = e.response;
        let isInit = isInitializationRequest(request);
        let streamId = scheduleController.getStreamProcessor().getStreamInfo().id;
        let chunk;

        if (!bytes) {
            log('No ' + request.mediaType + ' bytes to push.');
            return;
        }

        chunk = createDataChunk(bytes, request, streamId);
        
        if (!isInit) {
            chunk.bytes = processNonInitChunks(bytes, request);
        }
        eventBus.trigger(isInit ? Events.INIT_FRAGMENT_LOADED : Events.MEDIA_FRAGMENT_LOADED, {chunk: chunk, fragmentModel: e.sender});
    }
    
    function isInitializationRequest(request) {
        return (request && request.type && request.type === HTTPRequest.INIT_SEGMENT_TYPE);
    }
    
    function reset() {
        eventBus.off(Events.FRAGMENT_LOADING_COMPLETED, onFragmentLoadingCompleted, this);
        fragmentModels = [];
    }
    
    function processNonInitChunks(bytes, request) {
        
        log("[MssFragmentController] processNonInitChunks for adaptation " + request.adaptationIndex);
        
        var result = null,
            manifest = manifestModel.getValue(),
            adaptation = null;
            
        let periodIndex = 0;

        adaptation = dashManifestModel.getAdaptationForIndex(request.adaptationIndex, manifest, periodIndex);
        if (bytes !== null && bytes !== undefined && bytes.byteLength > 0) {
            result = new Uint8Array(bytes);
        } else {
            return null;
        }

        if (request && (request.type === HTTPRequest.MEDIA_SEGMENT_TYPE) && manifest) {
            // Get adaptation containing provided representations
            // (Note: here representations is of type Dash.vo.Representation)
            //adaptation = manifest.Period_asArray[representations[0].adaptation.period.index].AdaptationSet_asArray[representations[0].adaptation.index];
            try{
                result = convertFragment(result, request, adaptation);
            }catch(e) {
                log('[MssFragmentController] Error in processNonInitChunks');
                throw e;
            }

            if (!result) {
                return null;
            }
        }

        return result;
    };

    function setSampleDuration(state) {
        fixDuration = state;
    };
    
    let instance = {
        process: process,
        getModel: getModel,
        detachModel: detachModel,
        isInitializationRequest: isInitializationRequest,
        reset: reset
    };
    
    
    setup();
    
    return instance;
}

MssFragmentController.__dashjs_factory_name = 'MssFragmentController';
export default FactoryMaker.getClassFactory(MssFragmentController);
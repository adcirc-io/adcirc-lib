// https://github.com/atdyer/adcirc-lib Version 0.0.1. Copyright 2017 Tristan Dyer.
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global.adcirc = global.adcirc || {})));
}(this, (function (exports) { 'use strict';

function file_reader ( file ) {

    var _file = file;
    var _file_size = file.size;
    var _reader = new FileReader();
    var _block_size = 4*256*256;    // ~1MB
    var _offset = 0;

    var _block_callback = function () {};
    var _continue_callback = function () { return true; };
    var _finished_callback = function () {};
    var _error_callback = function () {};

    var _r = function ( file ) {

        _file = file;
        _file_size = file.size;

    };

    _r.read = function () {
        read_block( _offset, _block_size, file );
        return _r;
    };

    _r.read_block = function ( start, end, cb ) {

        var block = _file.slice( start, end );
        _reader.onload = function ( dat ) {

            if ( dat.target.error !== null ) {
                _error_callback( dat.target.error );
                throw dat.target.error;
            }

            cb( dat.target.result );

        };
        _reader.readAsText( block );

    };

    _r.block_size = function ( _ ) {
        if ( !arguments.length ) return _block_size;
        _block_size = _;
        return _r;
    };

    _r.offset = function ( _ ) {
        if ( !arguments.length ) return _offset;
        _offset = _;
        return _r;
    };

    _r.block_callback = function ( _ ) {
        if ( !arguments.length ) return _block_callback;
        if ( typeof _ == 'function' ) _block_callback = _;
        return _r;
    };

    _r.continue_callback = function ( _ ) {
        if ( !arguments.length ) return _continue_callback;
        if ( typeof _ == 'function' ) _continue_callback = _;
        return _r;
    };

    _r.finished_callback = function ( _ ) {
        if ( !arguments.length ) return _finished_callback;
        if ( typeof _ == 'function' ) _finished_callback = _;
        return _r;
    };

    _r.error_callback = function ( _ ) {
        if ( !arguments.length ) return _error_callback;
        if ( typeof _ == 'function' ) _error_callback = _;
        return _r;
    };

    function read_block ( start_index, block_size, f ) {

        var block = f.slice( start_index, start_index + block_size );
        _reader.onload = parse_block;
        _reader.readAsText( block );

    }

    function parse_block ( block ) {

        if ( block.target.error !== null ) {
            _error_callback( block.target.error );
            throw block.target.error;
        }

        // Get the data
        var data = block.target.result;

        // Calculate offset for next read
        _offset += data.length;

        // Determine if there will be another read
        if ( _offset >= _file_size ) {

            // There won't so pass all of the data to the parsing callback
            _block_callback( data );

            // Now we're finished
            _finished_callback();

        } else {

            // There will, so pass the data to the parsing callback
            _block_callback( data );

            // Check that we should still continue
            if ( _continue_callback() ) {

                // We should, so read the next block
                read_block( _offset, _block_size, file );

            } else {

                // We shouldn't, so we're finished
                _finished_callback();

            }

        }

    }

    return _r;

}

var worker = function ( code ) {

    var blob_url = URL.createObjectURL( new Blob(
        [ code ],
        { type: 'application/javascript' } )
    );
    var worker = new Worker( blob_url );

    URL.revokeObjectURL( blob_url );

    return worker;

};

function build_fort14_worker () {

    var reader;
    var file_size;

    var blob_loc = 0;
    var file_loc = 0;

    var line = 0;
    var line_map = {};
    var line_part = '';

    var regex_line = /.*\r?\n/g;
    var regex_nonwhite = /\S+/g;

    var agrid;
    var info_line;
    var num_nodes;
    var num_elements;
    var min_x = Infinity, max_x = -Infinity;
    var min_y = Infinity, max_y = -Infinity;
    var min_z = Infinity, max_z = -Infinity;

    var node_array;
    var node_map = {};
    var element_array;
    var element_map = {};

    var nope;
    var neta;
    var nbou;
    var nvel;
    var elev_segments = [];
    var flow_segments = [];
    var segment_length = -1;
    var segment = [];

    var nodes_read = false;
    var elements_read = false;

    var on_nodes = [];
    var on_elements = [];

    var progress = 0;
    var progress_interval = 2;
    var next_progress = progress + progress_interval;

    self.addEventListener( 'message', function ( message ) {

        message = message.data;

        switch ( message.type ) {

            case 'read':

                file_size = message.file.size;

                post_start( 'load_mesh' );

                reader = file_reader( message.file )
                    .block_callback( parse_data )
                    .finished_callback( done )
                    .error_callback( on_error )
                    .read();

                break;

            case 'get':

                if ( message.what === 'nodes' ) {
                    on_nodes.push( post_nodes );
                    check_queues();
                }

                if ( message.what === 'elements' ) {
                    on_elements.push( post_elements );
                    check_queues();
                }

                break;

        }

    });

    function check_queues () {

        var callback;

        // Check nodes queue
        if ( nodes_read && on_nodes.length ) {
            while ( ( callback = on_nodes.shift() ) !== undefined ) {
                callback();
            }
        }

        // Check elements queue
        if ( elements_read && on_elements.length ) {
            while ( ( callback = on_elements.shift() ) !== undefined ) {
                callback();
            }
        }

    }

    function done () {

        parse_data( '\n' );
        post_finish( 'load_mesh' );
        check_queues();

    }

    function flatten ( map, type ) {

        var flat = [];
        for ( var key in map ) {
            if ( map.hasOwnProperty( key ) ) {
                flat.push( key, map[key] );
            }
        }

        return new type( flat );

    }

    function on_error ( error ) {

        post_error( error );

    }

    function parse_data ( data ) {

        // Reset the blob location
        blob_loc = 0;

        // Add any leftover line parts from the last parse
        data = line_part + data;

        // Perform matching
        var dat;
        var match;
        while ( ( match = regex_line.exec( data ) ) !== null ) {

            // Progress stuff
            if ( 100 * ( file_loc + match.index ) / file_size > next_progress ) {

                post_progress( next_progress, 'load_mesh' );
                next_progress += progress_interval;

            }

            // Read the AGRID line
            if ( line == 0 ) {

                line_map[ 'agrid' ] = file_loc + match.index;
                agrid = match[0].trim();

            }

            // Read the mesh info line
            else if ( line == 1 ) {

                line_map[ 'info_line' ] = file_loc + match.index;
                info_line = match[0].trim();

                // Get the number of elements and nodes
                dat = info_line.match( regex_nonwhite );
                num_elements = parseInt( dat[0] );
                num_nodes = parseInt( dat[1] );

                // Allocate the arrays
                node_array = new Float32Array( 3 * num_nodes );
                element_array = new Uint32Array( 3 * num_elements );

            }

            else if ( line >= 2 && line < 2 + num_nodes ) {

                if ( line == 2 ) {
                    line_map[ 'nodes' ] = file_loc + match.index;
                }

                parse_node_line( match[0] );

            }

            else if ( line >= 2 + num_nodes && line < 2 + num_nodes + num_elements ) {

                nodes_read = true;

                if ( line == 2 + num_nodes ) {
                    line_map[ 'elements' ] = file_loc + match.index;
                }

                parse_element_line( match[0] );

            }

            else if ( nope === undefined ) {

                elements_read = true;

                line_map[ 'nope' ] = file_loc + match.index;

                dat = match[0].match( regex_nonwhite );
                nope = parseInt( dat[0] );

            }

            else if ( neta === undefined ) {

                line_map[ 'neta' ] = file_loc + match.index;

                dat = match[0].match( regex_nonwhite );
                neta = parseInt( dat[0] );

            }

            else if ( elev_segments.length == nope && nbou === undefined ) {

                line_map[ 'nbou' ] = file_loc + match.index;

                dat = match[0].match( regex_nonwhite );
                nbou = parseInt( dat[0] );

            }

            else if ( elev_segments.length == nope && nvel === undefined ) {

                line_map[ 'nvel' ] = file_loc + match.index;

                dat = match[0].match( regex_nonwhite );
                nvel = parseInt( dat[0] );

            }

            else if ( segment_length == -1 && ( elev_segments.length < nope || flow_segments.length < nbou ) ) {

                dat = match[0].match( regex_nonwhite );
                segment_length = parseInt( dat[0] );
                segment = [];

            }

            else if ( segment.length < segment_length ) {

                dat = match[0].match( regex_nonwhite );
                segment.push( parseInt( dat[0] ) );

                if ( segment.length == segment_length ) {

                    if ( elev_segments.length < nope ) {

                        elev_segments.push( segment );

                    }

                    else if ( flow_segments.length < nbou ) {

                        flow_segments.push( segment );

                    }

                    segment_length = -1;
                    segment = [];

                }

            }

            blob_loc = regex_line.lastIndex;
            line += 1;

        }

        line_part = data.slice( blob_loc );

        file_loc += blob_loc;

    }

    function parse_node_line ( str ) {

        var dat = str.match( regex_nonwhite );
        var nn = parseInt( dat[0] );
        var x = parseFloat( dat[1] );
        var y = parseFloat( dat[2] );
        var z = parseFloat( dat[3] );

        if ( x < min_x ) min_x = x;
        else if ( x > max_x ) max_x = x;
        if ( y < min_y ) min_y = y;
        else if ( y > max_y ) max_y = y;
        if ( z < min_z ) min_z = z;
        else if ( z > max_z ) max_z = z;

        var node_index = line - 2;
        node_array[ 3 * node_index ] = x;
        node_array[ 3 * node_index + 1 ] = y;
        node_array[ 3 * node_index + 2 ] = z;

        node_map[ nn ] = node_index;

    }

    function parse_element_line ( str ) {

        var dat = str.match( regex_nonwhite );
        var element_index = line - num_nodes - 2;
        var en = parseInt( dat[0] );
        element_array[ 3 * element_index ] = parseInt( dat[2] );
        element_array[ 3 * element_index + 1 ] = parseInt( dat[3] );
        element_array[ 3 * element_index + 2 ] = parseInt( dat[4] );

        element_map[ en ] = element_index;

    }

    function post_start ( task ) {

        var message = {
            type: 'start'
        };

        if ( task ) message.task = task;

        self.postMessage( message );
    }

    function post_progress ( progress, task ) {

        var message = {
            type: 'progress',
            progress: progress
        };

        if ( task ) message.task = task;

        self.postMessage( message );
    }

    function post_finish ( task ) {

        var message = {
            type: 'finish'
        };

        if ( task ) message.task = task;

        self.postMessage( message );
    }

    function post_elements () {
        var element_map_flat = flatten( element_map, Uint32Array );
        var message = {
            type: 'elements',
            element_array: element_array.buffer,
            element_map: element_map_flat.buffer
        };
        self.postMessage(
            message,
            [ message.element_array, message.element_map ]
        );
    }

    function post_nodes () {
        var node_map_flat = flatten( node_map, Uint32Array );
        var message = {
            type: 'nodes',
            node_array: node_array.buffer,
            node_map: node_map_flat.buffer,
            dimensions: 3
        };
        self.postMessage(
            message,
            [ message.node_array, message.node_map ]
        );
    }

    function post_error ( error ) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }

}

function fort14_worker () {

    var code = '';
    code += file_reader.toString();
    code += build_fort14_worker.toString();
    code += 'build_fort14_worker();';

    return worker( code );

}

function nest ( flat ) {
    var map = d3.map();
    var num_entries = flat.length/2;
    for ( var i=0; i<num_entries; ++i ) {
        map.set( flat[ 2*i ], flat[ 2*i + 1 ] );
    }
    return map;
}

function dispatcher ( object ) {

    object = object || Object.create( null );

    var _listeners = {};
    var _oneoffs = {};

    object.on = function ( type, listener ) {

        if ( !arguments.length ) return object;
        if ( arguments.length == 1 ) return _listeners[ type ];

        if ( _listeners[ type ] === undefined ) {

            _listeners[ type ] = [];

        }

        if ( _listeners[ type ].indexOf( listener ) === - 1 ) {

            _listeners[ type ].push( listener );

        }

        return object;

    };

    object.once = function ( type, listener ) {

        if ( !arguments.length ) return object;
        if ( arguments.length == 1 ) return _oneoffs[ type ];

        if ( _oneoffs[ type ] === undefined ) {

            _oneoffs[ type ] = [];

        }

        if ( _oneoffs[ type ].indexOf( listener ) === - 1 ) {

            _oneoffs[ type ].push( listener );

        }

        return object;

    };

    object.off = function ( type, listener ) {

        var listenerArray = _listeners[ type ];
        var oneoffArray = _oneoffs[ type ];
        var index;

        if ( listenerArray !== undefined ) {

            index = listenerArray.indexOf( listener );

            if ( index !== - 1 ) {

                listenerArray.splice( index, 1 );

            }

        }

        if ( oneoffArray !== undefined ) {

            index = oneoffArray.indexOf( listener );

            if ( index !== -1 ) {

                oneoffArray.splice( index, 1 );

            }

        }

        return object;

    };

    object.dispatch = function ( event ) {

        var listenerArray = _listeners[ event.type ];
        var oneoffArray = _oneoffs[ event.type ];

        var array = [], i, length;

        if ( listenerArray !== undefined ) {

            if ( event.target === undefined )
                event.target = object;

            length = listenerArray.length;

            for ( i = 0; i < length; i ++ ) {

                array[ i ] = listenerArray[ i ];

            }

            for ( i = 0; i < length; i ++ ) {

                array[ i ].call( object, event );

            }

        }

        if ( oneoffArray !== undefined ) {

            if ( event.target === undefined )
                event.target = object;

            length = oneoffArray.length;

            for ( i = 0; i < length; i ++ ) {

                array[ i ] = oneoffArray[ i ];

            }

            for ( i = 0; i < length; i ++ ) {

                array[ i ].call( object, event );

            }

            _oneoffs[ event.type ] = [];

        }

        return object;

    };

    return object;

}

function fort14 () {

    var _worker = fort14_worker();
    var _fort14 = dispatcher();

    var _elements;
    var _nodes;

    _fort14.elements = function ( _ ) {

        if ( !arguments.length ) return _elements;

        _elements = _;

        return _fort14;

    };

    _fort14.nodes = function ( _ ) {

        if ( !arguments.length ) return _nodes;

        _nodes = _;

        return _fort14;
    };

    _fort14.read = function ( file ) {
        _worker.postMessage({
            type: 'read',
            file: file
        });
    };

    _worker.addEventListener( 'message', function ( message ) {

        message = message.data;

        switch ( message.type ) {

            case 'start':

                _fort14.dispatch( message );

                break;

            case 'progress':

                _fort14.dispatch( message );

                break;

            case 'finish':

                _fort14.dispatch( message );

                _worker.postMessage({
                    type: 'get',
                    what: 'nodes'
                } );

                _worker.postMessage({
                    type: 'get',
                    what: 'elements'
                } );

                break;

            case 'nodes':

                _nodes = {
                    array: new Float32Array( message.node_array ),
                    map: nest( new Uint32Array( message.node_map ) ),
                    dimensions: message.dimensions,
                    names: [ 'x', 'y', 'depth' ]
                };

                _fort14.dispatch( {
                    type: 'nodes',
                    nodes: _nodes
                } );

                if ( _nodes && _elements ) _fort14.dispatch( { type: 'ready' } );

                break;

            case 'elements':

                _elements = {
                    array: new Uint32Array( message.element_array ),
                    map: nest( new Uint32Array( message.element_map ) )
                };

                _fort14.dispatch( {
                    type: 'elements',
                    elements: _elements
                } );

                if ( _nodes && _elements ) _fort14.dispatch( { type: 'ready' } );

                break;
        }

    });

    return _fort14;

}

function build_fortnd_worker () {

    var file;
    var file_size;
    var reader;
    var num_dims;
    var num_datasets = 0;
    var num_nodes = 0;
    var ts;
    var ts_interval;

    var timesteps = [];
    var dequeueing = false;
    var process_queue = [];
    var wait_queue = [];

    var mapping = {
        block_size: 1024*1024*10,    // Read 10MB at a time
        location: 0,
        header: null,
        ts_index: 0,
        node_index: 0,
        finished: false,
        final_check: false
    };

    var nodal_timeseries = { seconds: [], timestep: [] };
    var mints = [];
    var maxts = [];

    self.addEventListener( 'message', function ( message ) {

        message = message.data;

        switch ( message.type ) {

            case 'read':

                file = message.file;
                num_dims = message.n_dims;

                enqueue( { type: 'prep_timeseries' } );

                read_header();
                break;

            case 'timeseries':

                enqueue( { type: 'timeseries', node_number: message.node_number } );
                if ( mapping.finished && !dequeueing ) check_queue();
                break;

            case 'timestep':

                enqueue( { type: 'timestep', index: message.index } );
                if ( mapping.finished && !dequeueing ) check_queue();
                break;

        }

    });

    function check_queue () {

        var task;
        var wait = wait_queue;
        wait_queue = [];
        while ( wait.length > 0 ) {

            task = wait.shift();
            enqueue( task );

        }

        task = process_queue.shift();

        if ( task !== undefined ) {

            dequeueing = true;

            if ( task.type === 'timestep' ) {

                load_timestep( task.index );

            }

            else if ( task.type === 'timeseries' ) {

                load_timeseries( task.node_number );

            }

            else if ( task.type === 'prep_timeseries' ) {

                load_all_timeseries();

            }

        } else {

            dequeueing = false;

            if ( !mapping.finished ) {

                resume_mapping();

            }

        }

    }

    function enqueue ( task ) {

        if ( task.type === 'timestep' ) {

            if ( task.index < timesteps.length ) {

                process_queue.push( task );

            } else {

                wait_queue.push( task );

            }

        }

        else if ( task.type === 'timeseries' || task.type === 'prep_timeseries' ) {

            if ( mapping.finished ) {

                process_queue.push( task );

            } else {

                wait_queue.push( task );

            }

        }

    }

    function load_all_timeseries () {

        post_start( 'timeseries_prep' );

        var newline_regex = /\r?\n/g;
        var nonwhite_regex = /\S+/g;

        var reader = new FileReaderSync();
        var data = reader.readAsText( file );
        var lines = data.split( newline_regex );

        // Get info about the data
        var infoline = lines[1].match( nonwhite_regex );
        var num_nodes = parseInt( infoline[1] );
        var num_ts = parseInt( infoline[0] );

        // Create empty lists
        for ( var node=0; node<num_nodes; ++node ) {

            nodal_timeseries[ (node+1).toString() ] = [];

        }

        // Read data
        for ( var ts=0; ts<num_ts; ++ts ) {

            var start_line = 2 + ts * ( num_nodes + 1 );
            var start_line_dat = lines[ start_line ].match( nonwhite_regex );

            nodal_timeseries.seconds.push( parseFloat( start_line_dat[ 0 ] ) );
            nodal_timeseries.timestep.push( parseInt( start_line_dat[ 1 ] ) );

            var currmin = Infinity;
            var currmax = -Infinity;

            post_progress( 100 * ts / num_datasets, 'timeseries_prep' );

            for ( node = 1; node < num_nodes + 1; ++node ) {

                var dat = parseFloat( lines[ start_line + node ].match( nonwhite_regex )[ 1 ] );
                if ( dat != -99999 ) {

                    if ( dat > currmax ) currmax = dat;
                    if ( dat < currmin ) currmin = dat;

                }

                nodal_timeseries[ node.toString() ].push( dat );

            }

            if ( currmax != Infinity ) {
                maxts.push( currmax );
            } else {
                maxts.push( null );
            }

            if ( currmin != Infinity ) {
                mints.push( currmin );
            } else {
                mints.push( null );
            }

        }

        post_finish( 'timeseries_prep' );

        check_queue();

    }

    function load_timeseries ( node_number ) {

        var timeseries = {
            array: new Float32Array( nodal_timeseries[ node_number ] ),
            node_number: node_number,
            min: [ mints[ node_number-1 ] ],
            max: [ maxts[ node_number-1 ] ]
        };

        post_timeseries( timeseries );
        check_queue();

    }

    function load_timestep ( timestep_index ) {

        var location = timesteps[ timestep_index ];
        var block_size = 1024 * 1024 * 5;   // Read 5MB at a time
        var regex_line = /.*\r?\n/g;
        var regex_nonwhite = /\S+/g;
        var ts = {
            array: new Float32Array( num_dims * num_nodes ),
            index: timestep_index,
            min: ( new Array( num_dims ) ).fill( Infinity ),
            max: ( new Array( num_dims ) ).fill( -Infinity )
        };
        var match, dat, val;
        var header;
        var line = 0;

        function parse_block ( data ) {

            while ( ( match = regex_line.exec( data ) ) !== null && line < num_nodes ) {

                if ( !header ) {

                    header = match[0].match( regex_nonwhite );
                    ts.model_time = parseFloat( header[0] );
                    ts.timestep = parseInt( header[1] );

                } else {

                    dat = match[0].match( regex_nonwhite );

                    for ( var i=0; i<num_dims; ++i ) {

                        val = parseFloat( dat[1] );
                        ts.array[ line++ ] = val;

                        if ( val !== -99999 ) {
                            if ( val < ts.min[ i ] ) ts.min[ i ] = val;
                            else if ( val > ts.max[ i ] ) ts.max[ i ] = val;
                        }

                    }

                }

                location += match[0].length;

            }

            if ( line < num_nodes ) {

                reader.read_block( location, location + block_size, parse_block );

            } else {

                post_timestep( ts );
                check_queue();

            }

        }

        reader.read_block( location, location + block_size, parse_block );

    }

    function read_header () {

        post_start();

        file_size = file.size;

        reader = file_reader( file )
            .error_callback( post_error );

        reader.read_block( 0, 1024, function ( data ) {

            // Regexes
            var regex_line = /.*\r?\n/g;
            var regex_nonwhite = /\S+/g;
            var end_of_header = 0;

            // Parse the first line
            var match = regex_line.exec( data );

            if ( match !== null ) {

                end_of_header += match[0].length;

                // Parse the second line
                match = regex_line.exec( data );

                if ( match !== null ) {

                    end_of_header += match[0].length;

                    var info_line = match[0];
                    var info = info_line.match( regex_nonwhite );

                    num_datasets = parseInt( info[0] );
                    num_nodes = parseInt( info[1] );
                    ts_interval = parseInt( info[3] );
                    ts = parseFloat( info[2] ) / ts_interval;

                    post_info();

                    mapping.location = end_of_header;
                    resume_mapping();

                }

            }

        });

    }

    function resume_mapping () {

        var regex_line = /.*\r?\n/g;
        var match;

        function parse_block ( data ) {

            while ( ( match = regex_line.exec( data ) ) !== null ) {

                if ( !mapping.header ) {

                    mapping.header = match[ 0 ];

                    timesteps[ mapping.ts_index++ ] = mapping.location;
                    post_progress( 100 * ( mapping.ts_index / num_datasets ), 'map_timesteps' );


                } else {

                    mapping.node_index += 1;

                    if ( mapping.node_index == num_nodes ) {

                        mapping.header = null;
                        mapping.node_index = 0;

                    }

                }

                mapping.location += match[0].length;

            }

            if ( mapping.ts_index < num_datasets ) {

                check_queue();

            } else {

                mapping.finished = true;
                post_finish( 'map_timesteps' );

                if ( !mapping.final_check ) {

                    mapping.final_check = true;
                    check_queue();

                }

            }


        }

        reader.read_block( mapping.location, mapping.location + mapping.block_size, parse_block );

    }


    function post_error ( error ) {

        self.postMessage({
            type: 'error',
            error: error.message
        });

    }

    function post_finish ( task ) {

        var message = {
            type: 'finish'
        };

        if ( task ) message.task = task;

        self.postMessage( message );

    }

    function post_info () {

        self.postMessage({
            type: 'info',
            file_size: file_size,
            num_datapoints: num_nodes,
            num_datasets: num_datasets,
            num_dimensions: num_dims,
            model_timestep: ts,
            model_timestep_interval: ts_interval
        });

    }

    function post_progress ( percent, task ) {

        var event = {
            type: 'progress',
            progress: percent
        };

        if ( task ) event.task = task;

        self.postMessage( event );

    }

    function post_start ( task ) {

        var message = {
            type: 'start'
        };

        if ( task ) message.task = task;

        self.postMessage( message );

    }

    function post_timeseries ( timeseries ) {

        var ranges = [];
        for ( var i=0; i<num_dims; ++i ) {
            ranges.push( [ timeseries.min[i], timeseries.max[i] ] );
        }

        var message = {
            type: 'timeseries',
            data_range: ranges,
            dimensions: num_dims,
            node_number: timeseries.node_number,
            array: timeseries.array.buffer
        };

        self.postMessage(
            message,
            [ message.array ]
        );

    }

    function post_timestep ( timestep ) {

        var ranges = [];
        for ( var i=0; i<num_dims; ++i ) {
            ranges.push( [ timestep.min[i], timestep.max[i] ] );
        }

        var message = {
            type: 'timestep',
            data_range: ranges,
            dimensions: num_dims,
            index: timestep.index,
            model_time: timestep.model_time,
            model_timestep: timestep.timestep,
            num_datasets: num_datasets,
            array: timestep.array.buffer
        };

        self.postMessage(
            message,
            [ message.array ]
        );

    }

}

function fortnd_worker() {

    var code = '';
    code += file_reader.toString();
    code += build_fortnd_worker.toString();
    code += 'build_fortnd_worker();';

    return worker( code );

}

function timestep ( message ) {

    var _timestep = {};

    var _array;
    var _data_range;
    var _dimensions;
    var _index;
    var _model_time;
    var _model_timestep;
    var _num_datasets;

    if ( message.hasOwnProperty( 'data_range' ) && message.hasOwnProperty( 'dimensions' ) &&
         message.hasOwnProperty( 'model_time' ) && message.hasOwnProperty( 'model_timestep' ) &&
         message.hasOwnProperty( 'index' ) && message.hasOwnProperty( 'array' ) ) {

        try {

            _data_range = message.data_range;
            _dimensions = message.dimensions;
            _index = message.index;
            _model_time = message.model_time;
            _model_timestep = message.model_timestep;
            _num_datasets = message.num_datasets;
            _array = new Float32Array( message.array );

        } catch ( e ) {

            console.error( 'Error building timestep' );
            console.error( e.message );
            throw( e );

        }

    } else {

        console.error( 'Timestep is missing data' );
        console.error( message );

    }


    _timestep.data = function () {

        return _array;

    };

    _timestep.data_range = function () {
        return _data_range;
    };

    _timestep.dimensions = function () {
        return _dimensions;
    };

    _timestep.index = function ( _ ) {
        if ( !arguments.length ) return _index;
        _index = _;
        return _timestep;
    };

    _timestep.model_time = function ( _ ) {
        if ( !arguments.length ) return _model_time;
        _model_time = _;
        return _timestep;
    };

    _timestep.model_timestep = function ( _ ) {
        if ( !arguments.length ) return _model_timestep;
        _model_timestep = _;
        return _timestep;
    };

    _timestep.num_datasets = function ( _ ) {
        if ( !arguments.length ) return _num_datasets;
        _num_datasets = _;
        return _timestep;
    };

    return _timestep;

}

function fortnd ( n_dims ) {

    var _file_size;
    var _num_datapoints;
    var _num_datasets;
    var _num_dimensions;
    var _model_timestep;
    var _model_timestep_interval;

    var _n_dims = n_dims;
    var _worker = fortnd_worker();
    var _fortnd = dispatcher();

    _fortnd.timeseries = function ( node_number, callback ) {

        if ( typeof callback === 'function' ) {

            _fortnd.once( 'timeseries' + node_number, function ( event ) {

                callback( event );

            });

        }

        _worker.postMessage({
            type: 'timeseries',
            node_number: node_number
        });

    };

    // Kick off the loading of a specific timestep. Optionally
    // pass in a callback that will be called only once when
    // the data is loaded. The 'timestep' event will also
    // be fired when the timestep has loaded
    _fortnd.timestep = function ( index, callback ) {

        if ( index >=0 && index < _num_datasets ) {

            if ( typeof callback === 'function' ) {

                _fortnd.once( 'timestep' + index, function ( event ) {

                    callback( event );

                } );

            }

            _worker.postMessage({
                type: 'timestep',
                index: index
            });

        }

        return _fortnd;
    };

    _fortnd.read = function ( file ) {
        _worker.postMessage({
            type: 'read',
            file: file,
            n_dims: n_dims
        });
        return _fortnd;
    };

    _worker.addEventListener( 'message', function ( message ) {

        message = message.data;

        switch ( message.type ) {

            case 'info':

                _file_size = message.file_size;
                _num_datapoints = message.num_datapoints;
                _num_datasets = message.num_datasets;
                _num_dimensions = message.num_dimensions;
                _model_timestep = message.model_timestep;
                _model_timestep_interval = message.model_timestep_interval;

                _fortnd.dispatch( {
                    type: 'info',
                    file_size: _file_size,
                    num_datapoints: _num_datapoints,
                    num_datasets: _num_datasets,
                    num_dimensions: _num_dimensions,
                    model_timestep: _model_timestep,
                    model_timestep_interval: _model_timestep_interval
                } );

                break;

            case 'start':

                _fortnd.dispatch( message );

                break;

            case 'progress':

                _fortnd.dispatch( message );

                break;

            case 'finish':

                _fortnd.dispatch( message );
                _fortnd.dispatch( { type: 'ready' } );

                break;

            case 'error':

                _fortnd.dispatch( { type: 'error', error: message.error } );
                break;

            case 'timeseries':

                var _node_number = message.node_number;

                var timeseries = {
                    array: new Float32Array( message.array ),
                    data_range: message.data_range,
                    dimensions: message.dimensions,
                    node_number: message.node_number
                };

                _fortnd.dispatch({
                    type: 'timeseries' + _node_number,
                    timeseries: timeseries
                });

                _fortnd.dispatch({
                    type: 'timeseries',
                    timeseries: timeseries
                });

                break;

            case 'timeseries_ready':

                _fortnd.dispatch( message );
                break;

            case 'timestep':

                var _timestep = timestep( message );

                _fortnd.dispatch( {
                    type: 'timestep',
                    timestep: _timestep
                });

                _fortnd.dispatch( {
                    type: 'timestep' + _timestep.index(),
                    timestep: _timestep
                });

                break;

        }

    });

    _worker.postMessage({ type: 'n_dims', n_dims: _n_dims });

    return _fortnd;

}

function fort63 () {
    return fortnd( 1 );
}

function fort64() {
    return fortnd( 2 );
}

function cache () {

    var _cache = dispatcher();

    var _cache_left;
    var _cache_right;

    var _max_size;
    var _size;

    var _getter;
    var _has_getter;
    var _transform;

    var _data;
    var _valid;
    var _num_valid = 0;
    var _start_index;

    // Define the cache located to the left of this cache
    _cache.cache_left = function ( _ ) {
        if ( !arguments.length ) return _cache_left;
        _cache_left = _;
        return _cache;
    };

    // Define the cache located to the right of this cache
    _cache.cache_right = function ( _ ) {
        if ( !arguments.length ) return _cache_right;
        _cache_right = _;
        return _cache;
    };

    // Returns true if the dataset index currently falls
    // inside the cache, false otherwise
    _cache.contains = function ( dataset_index ) {
        return dataset_index >= _start_index && dataset_index < _start_index + _size;
    };

    // Returns the dataset at the given index if it is loaded,
    // otherwise returns undefined.
    _cache.get = function ( dataset_index ) {

        if ( !_is_initialized() ) {
            console.error( 'Cache has not been properly initialized' );
            return;
        }

        if ( _cache.valid( dataset_index ) ) {

            return _data[ _index( dataset_index ) ];

        }

        if ( dataset_index < 0 || dataset_index >= _max_size ) {
            console.error( dataset_index + ' is outside allowable range' );
            return;
        }

        if ( dataset_index == _start_index - 1 ) {

            if ( _cache.shift_left() ) {
                return _data[ _index( dataset_index ) ];
            }

            return;

        }

        if ( dataset_index == _start_index + _size ) {

            if ( _cache.shift_right() ) {

                return _data[ _index( dataset_index ) ];
            }

            return;

        }

        console.error( 'Jumps not yet supported. Coming soon...' );

    };

    // Defines the asynchronous function that can
    // be used to load data. The getter function is passed
    // the dataset index to get, and the cache.set function
    // as a callback that accepts the dataset index and
    // the data.
    _cache.getter = function ( _ ) {
        if ( !arguments.length ) return _getter;
        if ( typeof _ === 'function' ) {
            _getter = _;
            _has_getter = true;
        }
        else console.error( 'Getter must be a function' );
        return _cache;
    };

    // Returns true if all data in the cache is valid, false otherwise
    _cache.is_full = function () {
        return _num_valid == _size;
    };

    // Define the upper bound of the total available datasets
    _cache.max_size = function ( _ ) {
        if ( !arguments.length ) return _max_size;
        _max_size = _;
        return _cache;
    };

    // Prints the cached data to the console
    _cache.print = function () {
        console.log( _data );
    };

    // Define the range of data currently held by this cache.
    // If left and right caches and getters have been defined,
    // they will be used to fetch data.
    _cache.range = function ( _ ) {

        if ( !arguments.length ) return [ _start_index, _start_index + _size ];
        if ( !_is_initialized() ) {
            console.error( 'Cache not yet initialized. Set size and accessors before range' );
            return;
        }
        if ( _[1] - _[0] !== _size ) {
            console.error( 'Invalid range for cache of size ' + _size );
            return;
        }

        _start_index = _[0];

        for ( var i=_start_index; i<_start_index + _size; ++i ) {

            if ( _cache_left && _cache_left.contains( i ) ) {

                _cache.set( i, _cache_left.get( i ) );

            }

            else if ( _cache_right && _cache_right.contains( i ) ) {

                _cache.set( i, _cache_right.get( i ) );

            }

            else {

                _getter( i, _cache.set );

            }

        }

        return _cache;

    };

    // Sets the dataset at dataset_index to dataset
    _cache.set = function ( dataset_index, dataset ) {

        if ( _cache.contains( dataset_index ) ) {

            _data[ _index( dataset_index ) ] = _transform( _index( dataset_index ), dataset );
            _validate( dataset_index );

        } else {

            console.warn( 'Dataset ' + dataset_index + ' does not fall into ' +
                'the cache range' );

        }

    };

    // Define the maximum number of datasets allowed in the cache
    _cache.size = function ( _ ) {
        if ( !arguments.length ) return _size;
        _size = _;
        if ( _data ) console.warn( 'Warning: Resizing cache, all data will be lost' );
        _data = new Array( _size );
        _valid = new Array( _size ).fill( false );
        _num_valid = 0;
        return _cache;
    };

    // Sets the transform that the data is passed through before storage
    _cache.transform = function ( _ ) {
        if ( !arguments.length ) return _transform;
        if ( typeof _ === 'function' ) _transform = _;
        return _cache;
    };

    // Causes the cache to shift left, taking from a left cache
    // if one is defined, or loading a new dataset if one is not
    _cache.shift_left = function () {

        var data;
        var dataset_index = _start_index - 1;

        if ( dataset_index < 0 ) {
            return false;
        }

        if ( _cache_left ) {

            // If there's a cache immediately to the left, we need to steal
            // its rightmost value and tell it to shift
            if ( _start_index == _cache_left.range()[1] ) {

                // Take the rightmost dataset from the left cache
                data = _cache_left.take_right();

            }

            // Otherwise, if there's a left cache and we're inside of it
            // just get the value from that cache, as long as that value is loaded
            else if ( _cache_left.valid( dataset_index ) ) {

                // Get the data from the left cache
                data = _cache_left.get( dataset_index );

            }

        }

        if ( _cache_right ) {

            // If there's a cache immediately to the right, we need to
            // tell it to shift left (as long as it isn't bumping up
            // against a left cache)
            if ( _start_index + _size == _cache_right.range()[0] ) {

                if ( _cache_left && _cache_right.range()[0] !== _cache_left.range()[1] ) {

                    _cache_right.shift_left();

                }

            }

            // Otherwise, if theres a right cache and we're inside of it
            // just get the value from that cache, as long as that value is loaded
            else if ( _cache_right.valid( dataset_index ) ) {

                // Get the data from the right cache
                data = _cache_right.get( dataset_index );

            }

        }

        // Check that we've got data or a method to get the data
        if ( typeof data === 'undefined' && !_has_getter ) return false;

        // Now perform the shift and invalidate the new data
        _start_index = dataset_index;
        _invalidate( _start_index );

        // If we got the data from somewhere else, use it.
        // Otherwise load the data asynchronously
        if ( typeof data !== 'undefined' )
            _cache.set( dataset_index, data );
        else
            _getter( dataset_index, _cache.set );

        return true;

    };

    // Causes the cache to shift right, overwriting the leftmost
    // data in the cache with the new dataset
    _cache.shift_right = function () {

        // Calculate the index of the dataset immediately to the right
        var data;
        var dataset_index = _start_index + _size;

        // Stop shifting if there isn't one
        if ( dataset_index >= _max_size ) {
            return false;
        }

        if ( _cache_right ) {

            // If there's a cache immediately to the right, we need to steal
            // its leftmost value and tell it to shift
            if ( dataset_index == _cache_right.range()[0] ) {

                // Take the leftmost dataset from the right cache
                data = _cache_right.take_left();

            }

            // Otherwise if there's a right cache and we're inside of it
            // just get the value from that cache, as long as that value is loaded
            else if ( _cache_right.valid( dataset_index ) ) {

                // Get the data from the right cache
                data = _cache_right.get( dataset_index );

            }

        }

        if ( _cache_left ) {

            // If there's a cache immediately to the left, we need to
            // tell it to shift right (as long as it isn't bumping up
            // against a right cache)
            if ( _start_index == _cache_left.range()[1] ) {

                if ( _cache_right && _cache_right.range()[0] !== _cache_left.range()[1] ) {

                    _cache_left.shift_right();

                }

            }

            // Otherwise, if there's a left cache and we're inside of it
            // just get the value from that cache, as long as that value is loaded
            else if ( _cache_left.valid( dataset_index ) ) {

                // Get the data from the left cache
                data = _cache_left.get( dataset_index );

            }

        }

        // Check that we've got data or a method to get the data
        if ( typeof data === 'undefined' && !_has_getter ) return false;

        // Now perform the shift and invalidate the new data
        _start_index = _start_index + 1;
        _invalidate( dataset_index );

        // If there is a right cache, we've got its data. Otherwise
        // we need to load the data asynchronously
        if ( _cache_right )
            _cache.set( dataset_index, data );
        else
            _getter( dataset_index, _cache.set );

        return true;

    };

    // Returns the leftmost data in the cache if valid and triggers
    // a right shift. Returns undefined without triggering a shift
    // if the leftmost data is not valid.
    _cache.take_left = function () {

        var dataset;
        var dataset_index = _start_index;

        if ( _valid[ _index( dataset_index ) ] ) {

            // Keep a reference to the dataset
            dataset = _data[ _index( dataset_index ) ];

            // Trigger a right shift
            _cache.shift_right();

        }

        return dataset;

    };

    // Returns the rightmost data in the cache if valid and triggers
    // a left shift. Returns undefined without triggering a shift
    // if the rightmost data is not valid.
    _cache.take_right = function () {

        // Only allow the data to be taken if it is valid
        var dataset;
        var dataset_index = _start_index + _size - 1;

        if ( _valid[ _index( dataset_index ) ] ) {

            // Keep a reference to the dataset
            dataset = _data[ _index( dataset_index ) ];

            // Trigger a left shift
            _cache.shift_left();

        }

        return dataset;

    };

    // Returns whether the dataset at that index is actually
    // loaded into the cache yet.
    _cache.valid = function ( dataset_index ) {
        return _cache.contains( dataset_index ) && _valid[ _index( dataset_index ) ];
    };


    // Default transform
    _transform = function ( index, dataset ) {
        return dataset;
    };

    // No default getter
    _getter = function () {
        console.error( 'A getter has not been defined for this cache.' );
    };

    return _cache;

    function _index ( dataset_index ) {

        return dataset_index % _size;

    }

    function _invalidate ( dataset_index ) {

        _valid[ _index( dataset_index ) ] = false;
        --_num_valid;

    }

    function _is_initialized () {

        if ( typeof _size === 'undefined' || typeof _max_size === 'undefined' ) {
            console.error( 'Cache sizes not defined' );
            return false;
        }

        if ( ( typeof _cache_left === 'undefined' || typeof _cache_right === 'undefined') && !_has_getter ) {
            console.error( 'A getter must be defined if cache is not bounded by other caches' );
            return false;
        }

        return true;

    }

    function _validate ( dataset_index ) {

        _valid[ _index( dataset_index ) ] = true;
        ++_num_valid;

        if ( _cache.is_full() ) {
            _cache.dispatch( { type: 'ready' } );
        }

    }

}

function fortnd_cached ( n_dims, size ) {

    var _current_timestep;
    var _max_timestep;

    var _file = fortnd( n_dims );
    var _fortnd = dispatcher();

    var _left_cache = cache()
        .size( size )
        .getter( request );
    var _right_cache = cache()
        .size( size )
        .getter( request );
    var _gl_cache = cache()
        .size( 1 )
        .cache_left( _left_cache )
        .cache_right( _right_cache );

    // Bubble events
    _file.on( 'start', _fortnd.dispatch );
    _file.on( 'progress', _fortnd.dispatch );
    _file.on( 'finish', _fortnd.dispatch );

    // Handle events
    _file.on( 'info', on_info );


    _fortnd.next_timestep = function () {

        if ( _current_timestep !== undefined ) {

            if ( _current_timestep + 1 < _max_timestep ) {
                get_timestep( _current_timestep + 1 );
            }

        }

    };

    _fortnd.open = function ( file ) {

        _file.read( file );
        return _fortnd;

    };

    _fortnd.previous_timestep = function () {

        if ( _current_timestep !== undefined ) {

            if ( _current_timestep - 1 >= 0 ) {
                get_timestep( _current_timestep - 1 );
            }

        }

    };

    _fortnd.timeseries = function ( node_number, callback ) {

        return _file.timeseries( node_number, callback );

    };

    _fortnd.timestep = function ( index ) {

        return _gl_cache.get( index );

    };

    return _fortnd;


    function dispatch_timestep ( timestep ) {

        _fortnd.dispatch({
            type: 'timestep',
            timestep: timestep
        });

    }

    function get_timestep ( index ) {

        var timestep = _gl_cache.get( index );
        if ( timestep !== undefined ) {

            _current_timestep = timestep.index();
            dispatch_timestep( timestep );

        }

    }


    function on_info ( event ) {

        _max_timestep = event.num_datasets;

        _left_cache
            .once( 'ready', function () {
                _gl_cache
                    .once( 'ready', function ( event ) {

                        get_timestep( 0 );
                        _fortnd.dispatch( event );

                    })
                    .max_size( event.num_datasets )
                    .range([0, 1]);
            })
            .max_size( event.num_datasets )
            .range([0, size]);

        _right_cache
            .max_size( event.num_datasets )
            .range([size, 2*size]);

        _fortnd.dispatch( event );

    }

    function request ( index, callback ) {

        _file.timestep( index, function ( event ) {

            callback( event.timestep.index(), event.timestep );

        } );

    }

}

function fort63_cached ( size ) {
    return fortnd_cached( 1, size );
}

function fort64_cached ( size ) {
    return fortnd_cached( 2, size );
}

function gl_extensions ( gl ) {

    var extensions = {};

    return {

        get: function ( name ) {

            if ( extensions[ name ] !== undefined ) {

                return extensions[ name ];

            }

            var extension;

            switch ( name ) {

                case 'WEBGL_depth_texture':
                    extension = gl.getExtension( 'WEBGL_depth_texture' ) || gl.getExtension( 'MOZ_WEBGL_depth_texture' ) || gl.getExtension( 'WEBKIT_WEBGL_depth_texture' );
                    break;

                case 'EXT_texture_filter_anisotropic':
                    extension = gl.getExtension( 'EXT_texture_filter_anisotropic' ) || gl.getExtension( 'MOZ_EXT_texture_filter_anisotropic' ) || gl.getExtension( 'WEBKIT_EXT_texture_filter_anisotropic' );
                    break;

                case 'WEBGL_compressed_texture_s3tc':
                    extension = gl.getExtension( 'WEBGL_compressed_texture_s3tc' ) || gl.getExtension( 'MOZ_WEBGL_compressed_texture_s3tc' ) || gl.getExtension( 'WEBKIT_WEBGL_compressed_texture_s3tc' );
                    break;

                case 'WEBGL_compressed_texture_pvrtc':
                    extension = gl.getExtension( 'WEBGL_compressed_texture_pvrtc' ) || gl.getExtension( 'WEBKIT_WEBGL_compressed_texture_pvrtc' );
                    break;

                case 'WEBGL_compressed_texture_etc1':
                    extension = gl.getExtension( 'WEBGL_compressed_texture_etc1' );
                    break;

                default:
                    extension = gl.getExtension( name );

            }

            if ( extension === null ) {

                console.warn( 'WebGL: ' + name + ' extension not supported.' );

            }

            extensions[ name ] = extension;

            return extension;

        }

    };

}

function web_gl_available ( canvas ) {

    return !! ( window.WebGLRenderingContext && ( canvas.getContext( 'webgl' ) || canvas.getContext( 'experimental-webgl' ) ) );

}

function m4 () {

    var mat = new Float32Array( 16 ).fill( 0 );
    var tmp = new Float32Array( 16 );
    mat[0] = mat[5] = mat[10] = mat[15] = 1;

    mat.identity = function () {

        mat.fill( 0 );
        mat[0] = mat[5] = mat[10] = mat[15] = 1;

        return mat;

    };

    mat.ortho = function ( left, right, bottom, top, near, far ) {

        mat[0]  = 2 / ( right - left );
        mat[1]  = 0;
        mat[2]  = 0;
        mat[3]  = 0;

        mat[4]  = 0;
        mat[5]  = 2 / (top - bottom);
        mat[6]  = 0;
        mat[7]  = 0;

        mat[8]  = 0;
        mat[9]  = 0;
        mat[10] = -1 / (far - near);
        mat[11] = 0;

        mat[12] = (right + left) / (left - right);
        mat[13] = (top + bottom) / (bottom - top);
        mat[14] = -near / (near - far);
        mat[15] = 1;

        return mat;

    };

    mat.scale = function ( kx, ky, kz ) {

        tmp[ 0] = kx * mat[0];
        tmp[ 1] = kx * mat[1];
        tmp[ 2] = kx * mat[2];
        tmp[ 3] = kx * mat[3];
        tmp[ 4] = ky * mat[4];
        tmp[ 5] = ky * mat[5];
        tmp[ 6] = ky * mat[6];
        tmp[ 7] = ky * mat[7];
        tmp[ 8] = kz * mat[8];
        tmp[ 9] = kz * mat[9];
        tmp[10] = kz * mat[10];
        tmp[11] = kz * mat[11];
        tmp[12] = mat[12];
        tmp[13] = mat[13];
        tmp[14] = mat[14];
        tmp[15] = mat[15];

        fill_mat();

        return mat;

    };

    mat.translate = function ( tx, ty, tz ) {

        fill_tmp();

        tmp[12] = mat[0]*tx + mat[4]*ty + mat[ 8]*tz + mat[12];
        tmp[13] = mat[1]*tx + mat[5]*ty + mat[ 9]*tz + mat[13];
        tmp[14] = mat[2]*tx + mat[6]*ty + mat[10]*tz + mat[14];
        tmp[15] = mat[3]*tx + mat[7]*ty + mat[11]*tz + mat[15];

        return fill_mat();

    };

    function fill_mat () {

        for ( var i=0; i<16; ++i ) {
            mat[i] = tmp[i];
        }

        return mat;

    }

    function fill_tmp () {

        for ( var i=0; i<16; ++i ) {
            tmp[i] = mat[i];
        }

        return tmp;

    }

    return mat;

}

function gl_renderer ( selection ) {

    var _renderer = dispatcher();
    var _selection = selection;
    var _canvas = selection.node();

    if ( !web_gl_available( _canvas ) ) return;

    var _gl_attributes = { alpha: false, antialias: false, premultiplieAlpha: false, stencil: true };
    var _gl = _canvas.getContext( 'webgl', _gl_attributes ) || _canvas.getContext( 'experimental-webgl', _gl_attributes);

    if ( _gl === null ) return;

    var _extensions = gl_extensions( _gl );
    _extensions.get( 'ANGLE_instanced_arrays' );
    _extensions.get( 'OES_element_index_uint' );
    _extensions.get( 'OES_standard_derivatives' );

    var _width = 0;
    var _height = 0;
    var _offset_y;
    var _pixel_ratio = 1;
    var _clear_color = d3.color( 'white' );

    var _projection_matrix = m4();
    var _zoom = d3.zoom()
        .on( 'zoom', zoomed );
    _selection
        .call( _zoom )
        .on( 'mousemove', on_hover )
        .on( 'click', on_click );

    var _needs_render = true;
    var _views = [];

    _renderer.add_view = function ( view ) {

        view.on( 'update', _renderer.render );
        _views.push( view );
        update_projection();
        return _renderer;

    };

    _renderer.clear_color = function ( _ ) {

        if ( !arguments.length ) return _clear_color;
        _clear_color = d3.rgb.apply( _clear_color, arguments );

        _gl.clearColor(
            _clear_color.r / 255,
            _clear_color.g / 255,
            _clear_color.b / 255,
            _clear_color.opacity
        );

        return _renderer.render();

    };

    _renderer.gl_context = function () {

        return _gl;

    };

    _renderer.remove_view = function ( view ) {

        view.off( 'update', _renderer.render );
        return _renderer;

    };

    _renderer.render = function () {

        _needs_render = true;
        return _renderer;

    };

    _renderer.set_view = function ( view ) {

        view.on( 'update', _renderer.render );
        _views = [ view ];
        update_projection();
        return _renderer;

    };

    _renderer.zoom_to = function ( _ ) {

        if ( !arguments.length ) return _renderer;

        var bounds = _.bounding_box();
        var duration = 0;
        var dx = bounds[1][0] - bounds[0][0],
            dy = bounds[1][1] - bounds[0][1],
            x = (bounds[0][0] + bounds[1][0]) / 2,
            y = _height - (bounds[0][1] + bounds[1][1]) / 2,
            scale = 0.9 / Math.max( dx / _width, dy / _height ),
            translate = [ _width / 2 - scale * x, _height / 2 - scale * y];

        if ( arguments.length == 2 )
            duration = arguments[1];

        _selection
            .transition()
            .duration( duration )
            .call(
                _zoom.transform,
                d3.zoomIdentity
                    .translate( translate[0], translate[1] )
                    .scale( scale )
            );

        return _renderer;

    };

    _canvas.addEventListener( 'webglcontextlost', _renderer.dispatch );
    _canvas.addEventListener( 'webglcontextrestored', _renderer.dispatch );
    _canvas.addEventListener( 'webglcontextcreationerror', _renderer.dispatch );

    check_render();

    return _renderer;

    function check_render () {

        if ( resize() || _needs_render ) {

            _needs_render = false;
            render();

        }

        requestAnimationFrame( check_render );

    }

    function on_click () {

        var mouse = d3.mouse( this );
        var transform = d3.zoomTransform( _canvas );
        var pos = transform.invert( mouse );
        pos[1] = _offset_y - pos[1];

        _renderer.dispatch({
            type: 'click',
            coordinates: pos,
            mouse: mouse,
            transform: transform,
            offset_y: _offset_y
        });

    }

    function on_hover () {

        var mouse = d3.mouse( this );
        var pos = d3.zoomTransform( _canvas ).invert( [mouse[0], mouse[1] ] );
        pos[1] = _offset_y - pos[1];

        _renderer.dispatch({
            type: 'hover',
            coordinates: pos
        });

    }


    function render () {

        _gl.clear( _gl.COLOR_BUFFER_BIT | _gl.DEPTH_BUFFER_BIT );

        for ( var i=0; i<_views.length; ++i ) {
            _views[i].render();
        }

    }

    function resize () {

        if ( _canvas.clientWidth !== _width || _canvas.clientHeight !== _height ) {

            _width = _canvas.clientWidth;
            _height = _canvas.clientHeight;
            _canvas.width = _width * _pixel_ratio;
            _canvas.height = _height * _pixel_ratio;
            _gl.viewport( 0, 0, _width, _height );

            if ( !_offset_y || _offset_y < 0 ) _offset_y = _height;

            update_projection();

            return true;

        }

        return false;

    }

    function update_projection ( k, tx, ty ) {

        if ( !arguments.length ) {
            var t = d3.zoomTransform( _canvas );
            return update_projection( t.k, t.x, t.y );
        }

        _projection_matrix
            .ortho( 0, _width, _height, 0, -10000, 10000 )
            .translate( tx, ty, 0 )
            .scale( k, -k, 1 )
            .translate( 0, -_offset_y, 0 );

        for ( var i=0; i<_views.length; ++i ) {
            _views[i].shader().projection( _projection_matrix );
        }

        _renderer.dispatch({
            type: 'projection',
            transform: d3.zoomTransform( _canvas )
        });

    }

    function zoomed () {

        var t = d3.event.transform;
        update_projection( t.k, t.x, t.y );
        _renderer.render();

    }

}

function geometry ( gl, mesh ) {

    var _gl = gl;
    var _mesh = mesh;

    var _num_triangles = 0;
    var _num_vertices = 0;
    var _multiplier = 1.0;

    var _buffers = d3.map();
    var _geometry = dispatcher();

    _geometry.bind_buffer = function ( attribute ) {

        var buffer = _buffers.get( attribute );

        if ( buffer ) {

            _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer.buffer );
            return buffer;

        }

    };

    _geometry.bounding_box = function () {

        var bbox = _mesh.bounding_box();
        var minx = bbox[0][0];
        var miny = bbox[0][1];
        var maxx = bbox[1][0];
        var maxy = bbox[1][1];
        return [ [_multiplier*minx, _multiplier*miny], [_multiplier*maxx, _multiplier*maxy] ];

    };

    _geometry.draw_arrays = function () {

        _gl.drawArrays( _gl.TRIANGLES, 0, _num_triangles * 3 );

    };

    _geometry.elemental_value = function ( value ) {

        var data = _mesh.elemental_value( value );

        if ( data ) {

            set_elemental_value( data );

            _geometry.dispatch({
                type: 'update',
                value: value
            });

        }

    };

    _geometry.nodal_value = function ( value ) {

        var data = _mesh.nodal_value( value );

        if ( data ) {

            set_nodal_value( data );

            _geometry.dispatch({
                type: 'update',
                value: value
            });

        }

    };


    initialize( _mesh.nodes(), _mesh.elements() );

    return _geometry;


    function initialize ( nodes, elements ) {

        var bbox = mesh.bounding_box();
        var min_dim = Math.min( bbox[1][0] - bbox[0][0], bbox[1][1] - bbox[0][1] );
        // while ( min_dim < Math.pow( 1, 32 ) ) {
        //     _multiplier *= 2;
        //     min_dim *= _multiplier;
        // }

        _num_vertices = elements.array.length;
        _num_triangles = elements.array.length / 3;

        var vertex_position = new Float32Array( 2 * _num_vertices );
        var vertex_value = new Float32Array( _num_vertices );
        var vertex_normals = new Float32Array( 3 * _num_vertices );

        var dimensions = nodes.dimensions;
        for ( var i=0; i<_num_vertices; ++i ) {

            var node_number = elements.array[ i ];
            var node_index = nodes.map.get( node_number );

            vertex_position[ 2 * i ] = nodes.array[ dimensions * node_index ] * _multiplier;
            vertex_position[ 2 * i + 1 ] = nodes.array[ dimensions * node_index + 1 ] * _multiplier;

        }

        for ( var i=0; i<_num_triangles; ++i ) {
            vertex_normals[ 9 * i ] = 1;
            vertex_normals[ 9 * i + 4 ] = 1;
            vertex_normals[ 9 * i + 8 ] = 1;
        }

        var position_buffer = _gl.createBuffer();
        _gl.bindBuffer( _gl.ARRAY_BUFFER, position_buffer );
        _gl.bufferData( _gl.ARRAY_BUFFER, vertex_position, _gl.STATIC_DRAW );

        var value_buffer = _gl.createBuffer();
        _gl.bindBuffer( _gl.ARRAY_BUFFER, value_buffer );
        _gl.bufferData( _gl.ARRAY_BUFFER, vertex_value, _gl.DYNAMIC_DRAW );

        var normal_buffer = _gl.createBuffer();
        _gl.bindBuffer( _gl.ARRAY_BUFFER, normal_buffer );
        _gl.bufferData( _gl.ARRAY_BUFFER, vertex_normals, _gl.STATIC_DRAW );

        _buffers.set( 'vertex_position', {
            buffer: position_buffer,
            size: 2,
            type: _gl.FLOAT,
            normalized: false,
            stride: 0,
            offset: 0
        });

        _buffers.set( 'vertex_value', {
            buffer: value_buffer,
            size: 1,
            type: _gl.FLOAT,
            normalized: false,
            stride: 0,
            offset: 0
        });

        _buffers.set( 'vertex_normal', {
            buffer: normal_buffer,
            size: 3,
            type: _gl.FLOAT,
            normalized: false,
            stride: 0,
            offset: 0
        });


    }

    function set_elemental_value ( data ) {

        var array = new Float32Array( 3 * _num_triangles );

        for ( var i=0; i<_num_triangles; ++i ) {

            var value = data[i];

            array[ 3 * i ] = value;
            array[ 3 * i + 1 ] = value;
            array[ 3 * i + 2 ] = value;

        }

        var buffer = _buffers.get( 'vertex_value' );
        _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer.buffer );
        _gl.bufferSubData( _gl.ARRAY_BUFFER, 0, array );

    }

    function set_nodal_value ( data ) {

        var array = new Float32Array( 3 * _num_triangles );
        var node_map = _mesh.nodes().map;
        var elements = _mesh.elements().array;

        for ( var i=0; i<3*_num_triangles; ++i ) {

            var node_number = elements[ i ];
            var node_index = node_map.get( node_number );

            array[ i ] = data[ node_index ];

        }

        var buffer = _buffers.get( 'vertex_value' );
        _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer.buffer );
        _gl.bufferSubData( _gl.ARRAY_BUFFER, 0, array );

    }

}

function view ( gl, geometry, shader ) {

    var _gl = gl;
    var _geometry = geometry;
    var _shader = shader;

    var _view = dispatcher();

    _view.elemental_value = function ( value ) {

        _geometry.elemental_value( value );
        return _view;

    };

    _view.nodal_value = function ( value ) {

        _geometry.nodal_value( value );
        return _view;

    };

    _view.render = function () {

        _shader.use();

        _shader.attributes().each( function ( attribute, key ) {

            var buffer = _geometry.bind_buffer( key );

            if ( buffer !== 'undefined' ) {

                _gl.vertexAttribPointer(
                    attribute,
                    buffer.size,
                    buffer.type,
                    buffer.normalized,
                    buffer.stride,
                    buffer.offset
                );

                _gl.enableVertexAttribArray( attribute );

            }

        } );

        _geometry.draw_arrays();
        return _view;

    };

    _view.shader = function ( _ ) {

        if ( !arguments.length ) return _shader;
        _.projection( _shader.projection() );
        _shader = _;
        _view.dispatch( { type: 'update' } );
        return _view;

    };

    _geometry.on( 'update', _view.dispatch );

    return _view;

}

function gl_shader ( gl, type, code, warn_cb, error_cb ) {

    var shader = gl.createShader( type );

    gl.shaderSource( shader, code );
    gl.compileShader( shader );

    if ( gl.getShaderParameter( shader, gl.COMPILE_STATUS ) === false ) {

        var info = gl.getShaderInfoLog( shader );
        if ( !error_cb ) error_cb = console.error;
        error_cb( 'Unable to compile shader' );
        error_cb( info );
        gl.deleteShader( shader );
        return;

    }

    if ( gl.getShaderParameter( shader, gl.COMPILE_STATUS ) === false ) {

        if ( !warn_cb ) warn_cb = console.warn;
        warn_cb( gl.getShaderInfoLog( shader ), add_line_numbers( code ) );

    }

    return shader;

}

function add_line_numbers ( code ) {

    var lines = code.split( '\n' );

    for ( var i = 0; i < lines.length; i ++ ) {

        lines[ i ] = ( i + 1 ) + ': ' + lines[ i ];

    }

    return lines.join( '\n' );

}

function gl_program ( gl, vertex_source, fragment_source, warn_cb, error_cb ) {

    var shader_program = gl.createProgram();
    var vertex_shader = gl_shader( gl, gl.VERTEX_SHADER, vertex_source, warn_cb, error_cb );
    var fragment_shader = gl_shader( gl, gl.FRAGMENT_SHADER, fragment_source, warn_cb, error_cb );

    if ( shader_program && vertex_shader && fragment_shader ) {

        gl.attachShader( shader_program, vertex_shader );
        gl.attachShader( shader_program, fragment_shader );
        gl.linkProgram( shader_program );

        if ( gl.getProgramParameter( shader_program, gl.LINK_STATUS ) === false ) {

            if ( !error_cb ) error_cb = console.error;
            error_cb( gl.getProgramInfoLog( shader_program ) );

        }

        gl.deleteShader( vertex_shader );
        gl.deleteShader( fragment_shader );

        return shader_program;

    }

}

function basic_shader ( gl ) {

    var _gl = gl;
    var _program = gl_program( _gl, basic_vertex(), basic_fragment() );
    var _face_color = d3.color( 'white' );
    var _wire_color = d3.color( 'black' );
    var _wire_alpha = 0.3;
    var _wire_width = 1.0;

    _gl.useProgram( _program );

    var _attributes = d3.map({
        'vertex_normal': _gl.getAttribLocation( _program, 'vertex_normal' ),
        'vertex_position': _gl.getAttribLocation( _program, 'vertex_position' )
    });

    var _uniforms = d3.map({
        'face_color': _gl.getUniformLocation( _program, 'face_color' ),
        'projection_matrix': _gl.getUniformLocation( _program, 'projection_matrix' ),
        'wire_alpha': _gl.getUniformLocation( _program, 'wire_alpha' ),
        'wire_color': _gl.getUniformLocation( _program, 'wire_color' ),
        'wire_width': _gl.getUniformLocation( _program, 'wire_width' )
    });

    _program.attribute = function ( attribute ) {
        return _attributes.get( attribute );
    };

    _program.attributes = function ( _ ) {
        if ( !arguments.length ) return _attributes;
        _attributes.each( _ );
        return _program;
    };

    _program.face_color = function ( _ ) {
        if ( !arguments.length ) return _face_color;
        _face_color = _;
        _gl.useProgram( _program );
        _gl.uniform3fv( _program.uniform( 'face_color' ), [ _.r/255, _.g/255, _.b/255 ] );
        return _program;
    };

    _program.set_projection = function ( matrix ) {

        _gl.useProgram( _program );
        _gl.uniformMatrix4fv( _program.uniform( 'projection_matrix' ), false, matrix );
        return _program;
    };

    _program.wire_alpha = function ( _ ) {
        if ( !arguments.length ) return _wire_alpha;
        _wire_alpha = _;
        _gl.useProgram( _program );
        _gl.uniform1f( _program.uniform( 'wire_alpha' ), _ );
        return _program;
    };

    _program.wire_color = function ( _ ) {
        if ( !arguments.length ) return _wire_color;
        _wire_color = _;
        _gl.useProgram( _program );
        _gl.uniform3fv( _program.uniform( 'wire_color' ), [_.r/255, _.g/255, _.b/255] );
        return _program;
    };

    _program.wire_width = function ( _ ) {
        if ( !arguments.length ) return _wire_width;
        _wire_width = _;
        _gl.useProgram( _program );
        _gl.uniform1f( _program.uniform( 'wire_width' ), _ );
        return _program;
    };

    _program.uniform = function ( uniform ) {
        return _uniforms.get( uniform );
    };

    _program.uniforms = function () {
        return _uniforms.keys();
    };

    _program.use = function () {

        _gl.useProgram( _program );
        return _program;

    };

    return _program
        .face_color( _program.face_color() )
        .wire_alpha( _program.wire_alpha() )
        .wire_color( _program.wire_color() )
        .wire_width( _program.wire_width() );

}

function basic_vertex () {

    return [
        'attribute vec3 vertex_position;',
        'attribute vec3 vertex_normal;',
        'uniform mat4 projection_matrix;',
        'varying vec3 _vertex_normal;',
        'void main( void ) {',
        '   gl_Position = projection_matrix * vec4( vertex_position, 1.0 );',
        '   _vertex_normal = vertex_normal;',
        '}'
    ].join('\n');

}

function basic_fragment () {

    return [
        '#extension GL_OES_standard_derivatives : enable',
        'precision highp float;',
        'varying vec3 _vertex_normal;',
        'uniform vec3 face_color;',
        'uniform vec3 wire_color;',
        'uniform float wire_alpha;',
        'uniform float wire_width;',
        'float edgeFactorTri() {',
        '   vec3 d = fwidth( _vertex_normal.xyz );',
        '   vec3 a3 = smoothstep( vec3( 0.0 ), d * wire_width, _vertex_normal.xyz );',
        '   return min( min( a3.x, a3.y ), a3.z );',
        '}',
        'void main() {',
        '   vec4 wire = mix( vec4(face_color, 1.0), vec4(wire_color, 1.0), wire_alpha);',
        '   if ( wire_width == 0.0 ) {',
        '       gl_FragColor = vec4(_vertex_color, 1.0);',
        '   } else {',
        '       gl_FragColor = mix( wire, vec4(_vertex_color, 1.0), edgeFactorTri() );',
        '   }',
        '}'
    ].join('\n');

}

function gradient_shader ( gl, num_colors, min, max ) {

    num_colors = num_colors > 1 ? num_colors : 2;

    var _gl = gl;
    var _program = gl_program( _gl, gradient_vertex( num_colors ), gradient_fragment() );
    var _gradient_colors = [];
    var _gradient_stops = [];
    var _projection;
    var _wire_color = d3.color( 'black' );
    var _wire_alpha = 0.3;
    var _wire_width = 1.0;

    var min = min || 0;
    var max = max || 1;
    for ( var i=0; i<num_colors; ++i ) {
        _gradient_stops.push( min + ( max-min ) * i/(num_colors-1) );
        _gradient_colors.push( d3.color( d3.schemeCategory20[i%num_colors] ) );
    }

    _gl.useProgram( _program );

    var _attributes = d3.map({
        'vertex_normal': _gl.getAttribLocation( _program, 'vertex_normal' ),
        'vertex_position': _gl.getAttribLocation( _program, 'vertex_position' ),
        'vertex_value': _gl.getAttribLocation( _program, 'vertex_value' )
    });

    var _uniforms = d3.map({
        'gradient_colors': _gl.getUniformLocation( _program, 'gradient_colors' ),
        'gradient_stops': _gl.getUniformLocation( _program, 'gradient_stops' ),
        'projection_matrix': _gl.getUniformLocation( _program, 'projection_matrix' ),
        'wire_alpha': _gl.getUniformLocation( _program, 'wire_alpha' ),
        'wire_color': _gl.getUniformLocation( _program, 'wire_color' ),
        'wire_width': _gl.getUniformLocation( _program, 'wire_width' )
    });

    _program.attribute = function ( attribute ) {
        return _attributes.get( attribute );
    };

    _program.attributes = function ( _ ) {
        if ( !arguments.length ) return _attributes;
        _attributes.each( _ );
        return _program;
    };

    _program.gradient_colors = function ( _ ) {
        if ( !arguments.length ) return _gradient_colors;
        _gradient_colors = _;
        var flattened = _gradient_colors
            .map( function ( color ) { return [ color.r/255, color.g/255, color.b/255 ] } )
            .reduce( function ( a, b ) { return a.concat( b ); }, [] );
        _gl.useProgram( _program );
        _gl.uniform3fv( _program.uniform( 'gradient_colors' ), flattened );
        return _program;
    };

    _program.gradient_stops = function ( _ ) {
        if ( !arguments.length ) return _gradient_stops;
        if ( _.length == 2 && num_colors !== 2 ) _ = interpolate_stops( _[0], _[1], num_colors );
        _gradient_stops = _;
        _gl.useProgram( _program );
        _gl.uniform1fv( _program.uniform( 'gradient_stops' ), _gradient_stops );
        return _program;
    };

    _program.projection = function ( matrix ) {
        if ( !arguments.length ) return _projection;
        _projection = matrix;
        _gl.useProgram( _program );
        _gl.uniformMatrix4fv( _program.uniform( 'projection_matrix' ), false, matrix );
        return _program;
    };

    _program.wire_alpha = function ( _ ) {
        if ( !arguments.length ) return _wire_alpha;
        _wire_alpha = _;
        _gl.useProgram( _program );
        _gl.uniform1f( _program.uniform( 'wire_alpha' ), _ );
        return _program;
    };

    _program.wire_color = function ( _ ) {
        if ( !arguments.length ) return _wire_color;
        _wire_color = _;
        _gl.useProgram( _program );
        _gl.uniform3fv( _program.uniform( 'wire_color' ), [_.r/255, _.g/255, _.b/255] );
        return _program;
    };

    _program.wire_width = function ( _ ) {
        if ( !arguments.length ) return _wire_width;
        _wire_width = _;
        _gl.useProgram( _program );
        _gl.uniform1f( _program.uniform( 'wire_width' ), _ );
        return _program;
    };

    _program.uniform = function ( uniform ) {
        return _uniforms.get( uniform );
    };

    _program.uniforms = function () {
        return _uniforms.keys();
    };

    _program.use = function () {
        _gl.useProgram( _program );
        return _program;
    };

    return _program
        .gradient_colors( _program.gradient_colors() )
        .gradient_stops( _program.gradient_stops() )
        .wire_alpha( _program.wire_alpha() )
        .wire_color( _program.wire_color() )
        .wire_width( _program.wire_width() );

    function interpolate_stops ( min, max, num_stops ) {

        var stops = [];

        for ( var i=0; i<num_stops; ++i ) {
            stops.push( min + ( max-min ) * i/(num_stops-1) );
        }

        return stops;

    }

}

function gradient_vertex ( num_colors ) {

    var code = [
        'attribute vec2 vertex_position;',
        'attribute vec3 vertex_normal;',
        'attribute float vertex_value;',
        'uniform mat4 projection_matrix;',
        'uniform float gradient_stops[' + num_colors + '];',
        'uniform vec3 gradient_colors[' + num_colors + '];',
        'varying vec3 _vertex_normal;',
        'varying vec3 _vertex_color;',
        'void main() {',
        '  gl_Position = projection_matrix * vec4( vertex_position, vertex_value, 1.0 );',
        '  _vertex_normal = vertex_normal;',
        '  _vertex_color = gradient_colors[0];',
        '  float t;'
    ];

    for ( var i=1; i<num_colors; ++i ) {
        code.push( '  t = clamp((vertex_value - gradient_stops['+(i-1)+']) / (gradient_stops['+i+']-gradient_stops['+(i-1)+']), 0.0, 1.0);' );
        code.push( '  _vertex_color = mix( _vertex_color, gradient_colors['+i+'], t*t*(3.0-2.0*t));');
    }

    code.push('}');

    return code.join( '\n' );

}

function gradient_fragment () {

    return [
        '#extension GL_OES_standard_derivatives : enable',
        'precision mediump float;',
        'varying vec3 _vertex_normal;',
        'varying vec3 _vertex_color;',
        'uniform vec3 wire_color;',
        'uniform float wire_alpha;',
        'uniform float wire_width;',
        'float edgeFactorTri() {',
        '   vec3 d = fwidth( _vertex_normal.xyz );',
        '   vec3 a3 = smoothstep( vec3( 0.0 ), d * wire_width, _vertex_normal.xyz );',
        '   return min( min( a3.x, a3.y ), a3.z );',
        '}',
        'void main() {',
        '   vec4 wire = mix( vec4(_vertex_color, 1.0), vec4(wire_color, 1.0), wire_alpha);',
        '   if ( wire_width == 0.0 ) {',
        '       gl_FragColor = vec4(_vertex_color, 1.0);',
        '   } else {',
        '       gl_FragColor = mix( wire, vec4(_vertex_color, 1.0), edgeFactorTri() );',
        '   }',
        '}'
    ].join('\n');

}

function slider () {

    var _selection;
    var _bar;

    var _arrows = 'both';
    var _bar_color = 'dimgray';
    var _color = 'lightgray';
    var _current = 0;
    var _width;
    var _height = 20;

    var _drag_bar = d3.drag().on( 'drag', dragged );
    var _drag_slider = d3.drag().on( 'start', clicked ).on( 'drag', dragged );
    var _draggable = true;
    var _jumpable = true;
    var _request = false;

    var _continuous = false;
    var _step = 1;
    var _domain = [0, 100];
    var _value_to_value = d3.scaleQuantize();
    var _value_to_percent = d3.scaleLinear().range( [0, 100] ).clamp( true );
    var _pixel_to_value = d3.scaleLinear();

    function _slider ( selection ) {

        // Setup
        _selection = selection
            .style( 'position', 'relative' )
            .style( 'width', '100%' )
            .style( 'margin-top', '4px' )
            .style( 'margin-bottom', '4px' )
            .style( 'user-select', 'none' );

        _bar = _selection
            .selectAll( 'div' )
            .data( [ 'slider_bar' ] );

        _bar.exit()
            .remove();

        _bar = _bar.enter()
            .append( 'div' )
            .merge( _bar );

        _bar.style( 'position', 'relative' )
            .style( 'left', 0 )
            .style( 'width', '1px' )
            .style( 'background-clip', 'content-box' )
            .style( 'margin', '-4px' )
            .style( 'border-width', '4px' )
            .style( 'border-style', 'solid' )
            .style( 'user-select', 'none' );

        // Scales
        _width = _selection.node().getBoundingClientRect().width;
        _pixel_to_value.domain( [ 0, _width ] );

        // Events
        _selection
            .on( 'mousedown', clicked )
            .on( 'wheel', scrolled );

        // Initialize
        _slider.arrows( _arrows );
        _slider.bar( _bar_color );
        _slider.color( _color );
        _slider.domain( _domain );
        _slider.draggable( _draggable );
        _slider.height( _height );
        _slider.jumpable( _jumpable );

        return _slider;

    }

    _slider.arrows = function ( _ ) {
        if ( !arguments.length ) return _arrows;
        if ( _ == 'top' || _ == 'bottom' || _ == 'both' || _ == 'none' ) {
            _arrows = _;
            if ( _bar ) {
                switch ( _arrows ) {

                    case 'both':
                        _bar.style( 'border-color', _bar_color + ' transparent ' + _bar_color + ' transparent' );
                        break;

                    case 'top':
                        _bar.style( 'border-color', _bar_color + ' transparent transparent transparent' );
                        break;

                    case 'bottom':
                        _bar.style( 'border-color', 'transparent transparent ' + _bar_color + ' transparent' );
                        break;

                    default:
                        _bar.style( 'border-color', 'transparent transparent transparent transparent' );
                        break;

                }
            }
        }
        return _slider;
    };

    _slider.bar = function ( _ ) {
        if ( !arguments.length ) return _bar_color;
        _bar_color = _;
        if ( _bar ) {
            _bar.style( 'background-color', _bar_color );
            _slider.arrows( _arrows );
        }
        return _slider;
    };

    _slider.color = function ( _ ) {
        if ( !arguments.length ) return _color;
        _color = _;
        if ( _selection ) _selection.style( 'background-color', _color );
        return _slider;
    };

    _slider.continuous = function ( _ ) {
        return arguments.length ? ( _continuous = !!_, _slider ) : _continuous;
    };

    _slider.current = function ( _ ) {
        return arguments.length ? ( set_current( _ ), _slider ) : _current;
    };

    _slider.domain = function ( _ ) {
        if ( !arguments.length ) return _value_to_percent.domain();

        _domain = _;
        var _range = [];
        _step = arguments.length == 2 ? arguments[1] : 1;
        for ( var i=_[0]; i<=_[1]; i+=_step ) _range.push( i );

        _value_to_value.domain( _ ).range( _range );
        _value_to_percent.domain( _ );
        _pixel_to_value.range( _ );

        return _slider;
    };

    _slider.draggable = function ( _ ) {
        if ( !arguments.length ) return _draggable;
        _draggable = !!_;
        if ( _bar ) {
            if ( !_draggable ) _bar.style( 'cursor', null ).on( '.drag', null );
            else _bar.style( 'cursor', 'pointer' ).call( _drag_bar );
        }
        return _slider;
    };

    _slider.height = function ( _ ) {
        if ( !arguments.length ) return _height;
        _height = _;
        if ( _selection ) _selection.style( 'min-height', _height + 'px' );
        if ( _bar ) _bar.style( 'min-height', _height + 'px' );
        return _slider;
    };

    _slider.jumpable = function ( _ ) {
        if ( !arguments.length ) return _jumpable;
        _jumpable = !!_;
        if ( _selection ) {
            if ( !_jumpable ) _selection.style( 'cursor', null ).on( '.drag', null );
            else _selection.style( 'cursor', 'pointer' ).call( _drag_slider );
        }
        return _slider;
    };

    _slider.needs_request = function ( _ ) {
        if ( !arguments.length ) return _request;
        _request = !!_;
        return _slider;
    };

    _slider.set = function ( value ) {

        set_current( value );

    };

    return dispatcher( _slider );

    function clamp ( value ) {
        var domain = _value_to_percent.domain();
        if ( value < domain[0] ) return domain[0];
        if ( value > domain[1] ) return domain[1];
        return value;
    }

    function clicked () {

        if ( _jumpable ) {
            var pixel = d3.mouse( this )[ 0 ];
            if ( pixel < 0 ) pixel = 0;
            if ( pixel > _width ) pixel = _width;
            var value = _pixel_to_value( pixel );
            if ( set_current( value ) ) dispatch_current();
        }

    }

    function dispatch_current () {

        _slider.dispatch( {
            type: 'value',
            value: _current
        } );

    }

    function dispatch_request ( value ) {

        var request_value = _current;
        if ( value > _current ) request_value += _step;
        if ( value < _current ) request_value -= _step;

        if ( request_value !== _current ) {

            _slider.dispatch( {
                type: 'request',
                value: request_value
            } );

        }

    }

    function dragged () {

        if ( _draggable ) {
            var pixel = d3.event.x;
            if ( pixel < 0 ) pixel = 0;
            if ( pixel > _width ) pixel = _width;
            var value = _pixel_to_value( pixel );
            if ( _request ) dispatch_request( value );
            else if ( set_current( value ) ) dispatch_current();
        }

    }

    function scrolled () {

        if ( _draggable ) {
            var multiplier = d3.event.shiftKey ? 10*_step : _step;
            var direction = d3.event.deltaX < 0 || d3.event.deltaY < 0 ? 1 : -1;
            if ( set_current( _slider.current() + multiplier * direction ) ) dispatch_current();
        }

    }

    function set_current ( value ) {
        value = _continuous ? clamp( value ) : _value_to_value( value );
        if ( value !== _current ) {
            if ( _jumpable ) _current = value;
            else _current = value > _current ? _current + _step : _current - _step;
            if ( _bar ) _bar.style( 'left', _value_to_percent( _current ) + '%' );
            return true;
        }
        return false;
    }

    

}

function button () {

    var _selection;
    var _filepicker;
    var _filepicker_cb;

    function _button ( selection ) {

        _selection = selection;
        _button.file_picker( _filepicker_cb );
        return _button;

    }

    _button.file_picker = function ( _ ) {

        if ( !arguments.length ) return _filepicker;
        if ( typeof _ !== 'function' ) return _button;

        _filepicker_cb = _;

        if ( !_filepicker && _selection ) {

            _filepicker = _selection.append( 'input' )
                .attr( 'type', 'file' )
                .style( 'display', 'none' )
                .on( 'click', function () {
                    d3.event.stopPropagation();
                })
                .on( 'change', function () {
                    if ( typeof _filepicker_cb === 'function' ) {
                        _filepicker_cb( _filepicker.node().files[0] );
                    }
                });

        }

        if ( _selection ) {

            _selection.on( 'click', function () {

                d3.event.preventDefault();
                _filepicker.node().click();

            });

        }

        return _button;

    };

    return _button;

}

function progress () {

    var _selection;
    var _bar;

    var _current = 0;
    var _height = 10;
    var _max = 100;
    var _min = 0;

    var _background_color = 'lightgray';
    var _color = 'steelblue';

    var _value_to_percent = d3.scaleLinear()
        .domain( [_min, _max] )
        .range( [0, 100] )
        .clamp( true );

    function _progress ( selection ) {

        _selection = selection
            .style( 'position', 'relative' )
            .style( 'width', '100%' )
            .style( 'user-select', 'none' );
            // .style( 'display', 'flex' )
            // .style( 'justify-content', 'center' )
            // .style( 'align-items', 'center' )
            // .style( 'font-size', '14px' );

        _bar = _selection
            .selectAll( 'div' )
            .data( [ 'progress_bar' ] );

        _bar.exit()
            .remove();

        _bar = _bar.enter()
            .append( 'div' )
            .merge( _bar );

        _bar.style( 'position', 'relative' )
            .style( 'left', 0 )
            .style( 'width', '0%' )
            .style( 'background-clip', 'content-box' )
            .style( 'user-select', 'none' );

        // Initialize
        _progress.background_color( _background_color );
        _progress.color( _color );
        _progress.height( _height );

        return _progress;

    }

    _progress.background_color = function ( _ ) {

        if ( !arguments.length ) return _background_color;
        _background_color = _;
        if ( _selection ) _selection.style( 'background-color', _background_color );
        return _progress;

    };

    _progress.color = function ( _ ) {

        if ( !arguments.length ) return _color;
        _color = _;
        if ( _bar ) _bar.style( 'background-color', _color );
        return _progress;

    };

    _progress.height = function ( _ ) {

        if ( !arguments.length ) return _height;
        _height = _;
        if ( _selection ) _selection.style( 'min-height', _height + 'px' );
        if ( _bar ) _bar.style( 'min-height', _height + 'px' );
        return _progress;

    };

    _progress.progress = function ( _ ) {

        if ( !arguments.length ) return _current;
        _current = _value_to_percent( _ );
        if ( _bar ) _bar.style( 'width', _current + '%' );
        return _progress;

    };

    return _progress;

}

function vertical_gradient () {

    var _selection;
    var _bar;
    var _track;
    var _sliders;

    var _bar_width = 50;
    var _track_width = 75;
    var _height = 250;

    var _stops = [
        { stop: 0, color: 'lightsteelblue' },
        { stop: 1, color: 'steelblue' }
    ];

    var _percent_to_value = d3.scaleLinear().domain( [ 0, 1 ] ).range( [ 0, 1 ] );
    var _percent_to_pixel = d3.scaleLinear().domain( [ 0, 1 ] ).range( [ _height, 0 ] );


    function _gradient ( selection ) {

        // Keep track of selection that will be the gradient
        _selection = selection;

        // Apply the layout
        layout( _selection );

        // Return the gradient
        return _gradient;

    }

    _gradient.stops = function ( stops, colors ) {

        var extent = d3.extent( stops );

        _percent_to_value.range( extent );

        _stops = [];

        for ( var i=0; i<stops.length; ++i ) {

            _stops.push( { stop: _percent_to_value.invert( stops[i] ), color: colors[i] } );

        }

        _stops = _stops.sort( sort );

        layout( _selection );

        return _gradient;

    };

    function build_css_gradient ( stops ) {

        var css = 'linear-gradient( 0deg, ';

        for ( var i=0; i<stops.length; ++i  ){

            var color = stops[i].color;
            var percent = 100 * stops[i].stop;
            css += color + ' ' + percent + '%';

            if ( i < stops.length-1 ) css += ',';

        }

        return css + ')';

    }

    function dragged ( d ) {

        var y = Math.max( 0, Math.min( _height, d3.event.y ) );

        d3.select( this )
            .style( 'top', y + 'px' );

        d.stop = _percent_to_pixel.invert( y );

        var sorted = _stops.sort( sort );

        _bar.style( 'background', build_css_gradient( sorted ) );
        _sliders.each( slider_text );

        _gradient.dispatch({
            type: 'gradient',
            stops: sorted.map( function ( stop ) { return _percent_to_value( stop.stop ); } ),
            colors: sorted.map( function ( stop ) { return stop.color; } )
        });

    }

    function layout ( selection ) {

        selection
            .style( 'position', 'relative' )
            .style( 'width', ( _bar_width + _track_width ) + 'px' )
            .style( 'user-select', 'none' )
            .style( 'min-height', _height + 'px' );

        _bar = selection
            .selectAll( '.gradient-bar' )
            .data( [ {} ] );

        _bar.exit().remove();

        _bar = _bar.enter()
            .append( 'div' )
            .attr( 'class', 'gradient-bar' )
            .merge( _bar );

        _bar.style( 'position', 'absolute' )
            .style( 'top', 0 )
            .style( 'left', 0 )
            .style( 'width', _bar_width + 'px' )
            .style( 'height', '100%' )
            .style( 'background', build_css_gradient( _stops ) )
            .style( 'user-select', 'none' );

        _track = selection
            .selectAll( '.gradient-track' )
            .data( [ {} ] );

        _track.exit().remove();

        _track = _track.enter()
            .append( 'div' )
            .attr( 'class', 'gradient-track' )
            .merge( _track );

        _track.style( 'position', 'absolute' )
            .style( 'top', 0 )
            .style( 'left', _bar_width + 'px' )
            .style( 'width', _track_width + 'px' )
            .style( 'height', '100%' )
            .style( 'user-select', 'none' );

        position_sliders();

    }

    function position_sliders () {

        _sliders = _track.selectAll( '.slider' )
            .data( _stops );

        _sliders.exit().remove();

        _sliders = _sliders.enter()
            .append( 'div' )
            .attr( 'class', 'slider' )
            .merge( _sliders );

        _sliders
            .style( 'width', '0px' )
            .style( 'height', '1px' )
            .style( 'border-width', '8px' )
            .style( 'border-style', 'solid' )
            .style( 'margin-top', '-8px' )
            .style( 'margin-left', '-8px')
            .style( 'position', 'absolute' )
            .style( 'left', 0 )
            .each( function ( d ) {

                d3.select( this )
                    .style( 'top', ( _height - d.stop * _height ) + 'px' )
                    .style( 'border-color', 'transparent ' + d.color + ' transparent transparent' )
                    .style( 'user-select', 'none' );

            })
            .each( slider_text )
            .call( d3.drag()
                .on( 'drag', dragged )
            );

    }

    function sort ( a, b ) {

        return a.stop > b.stop;

    }

    function slider_text ( d ) {

        var text = d3.select( this )
            .selectAll( 'div' ).data( [ {} ] );

        text.exit().remove();

        text = text.enter()
            .append( 'div' )
            .merge( text );

        text.style( 'position', 'absolute' )
            .style( 'top', '50%' )
            .style( 'left', '8px' )
            .style( 'transform', 'translateY(-50%)' )
            .style( 'padding-left', '4px' )
            .style( 'font-size', '13px' )
            .style( 'font-family', 'serif' )
            .style( 'min-width', ( _track_width - 12 ) + 'px' )
            .style( 'user-select', 'none' )
            .style( 'cursor', 'default' )
            .text( _percent_to_value( d.stop ).toFixed( 5 ) );

    }

    return dispatcher( _gradient );

}

function ui ( selection ) {

    var _ui = Object.create( null );

    selection.selectAll( '.adc-slider' )
        .each( function () {

            var _slider = d3.select( this );
            var _id = _slider.attr( 'id' );

            if ( exists( _id ) ) {
                return unique_error();
            }

            _ui[ _id ] = slider()( column_container( _slider ) );

        });

    selection.selectAll( '.adc-button' )
        .each( function () {

            var _button = d3.select( this );
            var _id = _button.attr( 'id' );

            if ( exists( _id ) ) {
                return unique_error();
            }

            _ui[ _id ] = button()( _button );

        });

    selection.selectAll( '.adc-progress' )
        .each( function () {

            var _progress = d3.select( this );
            var _id = _progress.attr( 'id' );

            if ( exists( _id ) ) {
                return unique_error();
            }

            _ui[ _id ] = progress()( _progress );

        });

    selection.selectAll( '.adc-gradient' )
        .each( function () {

            var _gradient = d3.select( this );
            var _id = _gradient.attr( 'id' );

            if ( exists( _id ) ) {
                return unique_error();
            }

            _ui[ _id ] = vertical_gradient()( _gradient );

        });

    return _ui;

    function column_container ( selection ) {

        return selection.append( 'div' )
            .style( 'display', 'flex' )
            .style( 'flex-direction', 'column' );

    }

    function exists ( id ) {

        return !id || !!_ui[ id ];

    }

    function unique_error () {
        console.error( 'All UI components must have a unique ID' );
    }

}

function mesh () {

    var _mesh = dispatcher();

    var _nodes = Object.create({
        array: [],
        map: d3.map(),
        dimensions: 2
    });
    var _elements = Object.create({
        array: [],
        map: d3.map()
    });

    var _nodal_values = d3.map();
    var _elemental_values = d3.map();

    var _bounding_box;

    _mesh.bounding_box = function () {

        return _bounding_box;

    };

    _mesh.bounds = function ( value ) {

        var array = _mesh.nodal_value( value ) || _mesh.elemental_value( value );
        if ( array ) return calculate_bounding_box({
            array: array,
            dimensions: 1
        });

    };

    _mesh.elemental_value = function ( value, array ) {

        if ( arguments.length == 1 ) return _elemental_values.get( value );
        if ( arguments.length == 2 && array.length == _elements.array.length / 3 ) {
            _elemental_values.set( value, array );
            _mesh.dispatch( {
                type: 'elemental_value',
                name: value,
                array: array
            } );
        }
        return _mesh;

    };

    _mesh.elemental_values = function () {

        return _elemental_values.keys();

    };

    _mesh.elements = function ( _ ) {

        if ( !arguments.length ) return _elements;
        if ( _.array && _.map ) _elements = _;

        _mesh.dispatch( {
            type: 'num_elements',
            num_elements: _mesh.num_elements()
        } );

        return _mesh;

    };

    _mesh.find_node = function ( coordinates ) {

        var num_nodes = _nodes.array.length / 2;
        var closest = {
            node_number: null,
            distance: Infinity
        };
        var min_distance = Infinity;

        for ( var x, y, d, i = 0; i < num_nodes; ++i ) {

            x = _nodes.array[ 2 * i ];
            y = _nodes.array[ 2 * i + 1 ];
            d = distance( x, y );

            if ( d < closest.distance ) {
                closest.distance = d;
                closest.node_number = i + 1;
                closest.coordinates = [ x, y ];
            }

        }

        return closest;

        function distance ( x, y ) {

            return ( x - coordinates[0] )*( x - coordinates[0] ) + ( y - coordinates[1] )*( y - coordinates[1] );

        }

    };

    _mesh.nodal_value = function ( value, array ) {

        if ( arguments.length == 1 ) return _nodal_values.get( value );
        if ( arguments.length == 2 && array.length == _nodes.array.length / _nodes.dimensions ) {
            _nodal_values.set( value, array );
            _mesh.dispatch( {
                type: 'nodal_value',
                name: value,
                array: array
            } );
        }
        return _mesh;

    };

    _mesh.nodal_values = function () {

        return _nodal_values.keys();

    };

    _mesh.nodes = function ( _ ) {

        if ( !arguments.length ) return _nodes;
        if ( _.array && _.map && _.dimensions ) store_nodes( _ );

        _mesh.dispatch( {
            type: 'bounding_box',
            bounding_box: _bounding_box
        } );

        _mesh.dispatch( {
            type: 'num_nodes',
            num_nodes: _mesh.num_nodes()
        } );

        return _mesh;

    };

    _mesh.num_elements = function () {

        return _elements.array.length / 3;

    };

    _mesh.num_nodes = function () {

        return _nodes.array.length / _nodes.dimensions;

    };

    return _mesh;


    function store_nodes ( nodes ) {

        var extra_dimensions = nodes.names ? Math.min( nodes.names.length, nodes.dimensions ) - 2 : 0;
        var num_nodes = nodes.array.length / nodes.dimensions;
        var arrays = [ new Float32Array( 2 * num_nodes ) ];

        for ( var i=0; i<extra_dimensions; ++i ) {
            arrays.push( new Float32Array( num_nodes ) );
        }

        for ( var node=0; node<num_nodes; ++node ) {

            arrays[ 0 ][ 2 * node ] = nodes.array[ nodes.dimensions * node ];
            arrays[ 0 ][ 2 * node + 1 ] = nodes.array[ nodes.dimensions * node + 1 ];

            for ( var dimension = 0; dimension < extra_dimensions; ++dimension ) {

                arrays[ 1 + dimension ][ node ] = nodes.array[ nodes.dimensions * node + 2 + dimension ];

            }
        }

        _nodes = {
            array: arrays[0],
            map: nodes.map,
            dimensions: 2,
            names: ['x', 'y']
        };

        for ( var dimension = 0; dimension < extra_dimensions; ++dimension ) {

            var name = nodes.names[ 2 + dimension ];
            _mesh.nodal_value( name, arrays[ 1 + dimension ] );

        }

        _bounding_box = calculate_bounding_box( _nodes );

    }

}

function calculate_bounding_box ( nodes ) {

    var array = nodes.array;
    var dims = nodes.dimensions;
    var numnodes = array.length / dims;
    var mins = [], maxs = [];
    for ( var i=0; i<dims; ++i ) {
        mins.push( Infinity );
        maxs.push( -Infinity );
    }

    for ( var node=0; node<numnodes; ++node ) {
        for ( var dim=0; dim<dims; ++dim ) {
            if ( array[ dims * node + dim ] !== -99999 ) {
                if ( array[ dims * node + dim ] < mins[ dim ] ) mins[ dim ] = array[ dims * node + dim ];
                if ( array[ dims * node + dim ] > maxs[ dim ] ) maxs[ dim ] = array[ dims * node + dim ];
            }
        }
    }

    return dims == 1 ? [ mins[0], maxs[0] ] : [ mins, maxs ];

}

function mesh_view ( m ) {

    var _mesh = m;
    var _view = dispatcher();

    var _name;

    _view.bounding_box = function () {

        return _mesh.bounding_box();

    };

    _view.mesh = function () {

        return _mesh;

    };

    _view.name = function ( _ ) {

        if ( !arguments.length ) return _name;
        _name = _;
        _view.dispatch({
            type: 'modify',
            target: _mesh,
            property: 'name',
            name: _name
        });
        return _view;

    };

    _view.select = function () {

        _view.dispatch({
            type: 'select',
            target: _mesh
        });

    };


    // Bubble events
    _mesh.on( 'bounding_box', _view.dispatch );
    _mesh.on( 'elemental_value', _view.dispatch );
    _mesh.on( 'nodal_value', _view.dispatch );


    return _view;

}

exports.fort14 = fort14;
exports.fort63 = fort63;
exports.fort64 = fort64;
exports.fort63_cached = fort63_cached;
exports.fort64_cached = fort64_cached;
exports.gl_renderer = gl_renderer;
exports.geometry = geometry;
exports.view = view;
exports.basic_shader = basic_shader;
exports.gradient_shader = gradient_shader;
exports.cache = cache;
exports.dispatcher = dispatcher;
exports.slider = slider;
exports.button = button;
exports.progress = progress;
exports.gradient = vertical_gradient;
exports.ui = ui;
exports.mesh_view = mesh_view;
exports.mesh = mesh;

Object.defineProperty(exports, '__esModule', { value: true });

})));

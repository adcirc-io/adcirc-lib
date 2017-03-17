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

                post_start();

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
        post_finish();
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

                post_progress( next_progress );
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

    function post_start () {
        self.postMessage({
            type: 'start'
        });
    }

    function post_progress ( progress ) {
        self.postMessage({
            type: 'progress',
            progress: progress
        });
    }

    function post_finish () {
        self.postMessage({
            type: 'finish'
        });
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
            node_map: node_map_flat.buffer
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

                _fort14.dispatch( { type: 'start' } );

                break;

            case 'progress':

                _fort14.dispatch( {
                    type: 'progress',
                    progress: message.progress
                } );

                break;

            case 'finish':

                _fort14.dispatch( { type: 'finish' } );

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
                    map: nest( new Uint32Array( message.node_map ) )
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

    var reading = false;
    var queue = [];

    var reader;
    var file_size;

    var agrid;
    var info_line;
    var n_dims;
    var num_datasets;
    var num_nodes;
    var ts;             // timestep in seconds
    var ts_interval;    // timestep interval (ie. written out every ts_interval timesteps)

    var timestep_map = {};
    var timesteps = [];

    self.addEventListener( 'message', function ( message ) {

        message = message.data;

        switch ( message.type ) {

            case 'n_dims':

                n_dims = message.n_dims;
                break;

            case 'read':

                map_file( message.file );
                break;

            case 'timestep':

                queue.push( function () {
                    load_timestep( message.index );
                });
                if ( !reading )
                    check_queue();

                break;

        }

    });

    function check_queue () {

        var cb = queue.shift();
        if ( cb ) {
            reading = true;
            cb();
        } else {
            reading = false;
        }

    }

    function load_timestep ( timestep_index ) {

        if ( timestep_index < num_datasets ) {

            // Get file location from mapping
            var timestep = timesteps[ timestep_index ];
            var start = timestep_map[ timestep ];
            var end = timestep_index == num_datasets - 1 ? file_size : timestep_map[ timesteps[ timestep_index + 1 ] ];

            reader.read_block(
                start,
                end,
                function ( data ) {
                    post_timestep( timestep_index, parse_timestep( data ) );
                    check_queue();
                }
            );

        }

    }

    function map_file ( file ) {

        // Store the file size for progress things
        file_size = file.size;

        post_start();

        // Create the file reader
        reader = file_reader( file )
            .error_callback( on_error );

        // Parse the file header
        reader.read_block( 0, 1024, parse_header );

    }

    function map_timesteps ( start_location ) {

        var index = 0;
        var timestep = timesteps[ index ];
        var location = start_location;

        var header_found = false;
        var header_predicted = false;
        var line_part = '';

        var chunk_size = 65536;

        reader.read_block(
            location,
            location + chunk_size,
            parse_block
        );

        function parse_block( data ) {

            data = line_part + data;

            // Regexes
            var regex_line = /.*\r?\n/g;
            var regex_nonwhite = /\S+/g;
            var match;

            var last_index = 0;
            var last_node = 1;

            while( ( match = regex_line.exec( data ) ) !== null ) {

                var dat = match[0].match( regex_nonwhite );

                if ( dat && dat.length >= 2 ) {

                    if ( !header_found ) {

                        if ( parseFloat( dat[ 1 ] ) == timestep ) {

                            header_found = true;
                            timestep_map[ timestep ] = location - line_part.length + match.index;
                            post_progress( 100 * ( index / num_datasets ) );

                        } else {

                            last_node = parseInt( dat[ 0 ] );

                        }

                    }

                    else {

                        var jump_size = match[ 0 ].length * num_nodes;
                        location = location - line_part.length + match.index + jump_size;
                        index += 1;
                        timestep = timesteps[ index ];
                        header_predicted = true;
                        header_found = false;
                        break;

                    }

                }

                last_index = regex_line.lastIndex;

            }

            line_part = '';

            if ( !header_predicted ) {

                if ( last_node < num_nodes / 2 ) {

                    location = location - chunk_size;
                    line_part = '';


                } else {

                    location = location + chunk_size;
                    line_part = data.slice( last_index );

                }

            } else {

                header_predicted = false;

            }

            if ( index < num_datasets ) {

                reader.read_block(
                    location,
                    location + chunk_size,
                    parse_block
                );

            } else {

                post_finish();

            }

        }

    }

    function parse_header ( data ) {

        // Regexes
        var regex_line = /.*\r?\n/g;
        var regex_nonwhite = /\S+/g;
        var end_of_header = 0;

        // Get the first line
        var match = regex_line.exec( data );

        if ( match !== null ) {

            agrid = match[0];
            end_of_header += match[0].length;

            // Get the second line
            match = regex_line.exec( data );

            if ( match !== null ) {

                info_line = match[0];
                end_of_header += match[0].length;

                var info = info_line.match( regex_nonwhite );
                num_datasets = parseInt( info[0] );
                num_nodes = parseInt( info[1] );
                ts_interval = parseInt( info[3] );
                ts = parseFloat( info[2] ) / ts_interval;

                for ( var i=0; i<num_datasets; ++i ) {
                    timesteps.push( (i+1)*ts_interval );
                }

                // Post info about the timeseries data
                post_info();

                // Map the timesteps
                map_timesteps( end_of_header );

            }

        }

    }

    function parse_timestep ( data ) {

        var regex_line = /.*\r?\n/g;
        var regex_nonwhite = /\S+/g;
        var ts = {
            array: new Float32Array( n_dims * num_nodes ),
            min: ( new Array( n_dims ) ).fill( Infinity ),
            max: ( new Array( n_dims ) ).fill( -Infinity )
        };
        var match, dat, val;
        var line = 0;

        while ( ( match = regex_line.exec( data ) ) !== null ) {

            if ( line == 0 ) {

                dat = match[0].match( regex_nonwhite );
                ts.model_time = parseFloat( dat[0] );
                ts.timestep = parseInt( dat[1] );

                line += 1;

            } else {

                dat = match[0].match( regex_nonwhite );

                for ( var i=0; i<n_dims; ++i ) {

                    val = parseFloat( dat[ 1 ] );
                    ts.array[ line++ - 1 ] = val;

                    if ( val !== -99999 ) {
                        if ( val < ts.min[ i ] ) ts.min[ i ] = val;
                        else if ( val > ts.max[ i ] ) ts.max[ i ] = val;
                    }

                }


            }

        }

        return ts;

    }

    function on_error ( error ) {

        post_error( error );

    }

    function post_info () {
        self.postMessage({
            type: 'info',
            file_size: file_size,                   // File size
            num_datapoints: num_nodes,              // Number of data points per timestep
            num_datasets: num_datasets,             // Number of complete datasets
            num_dimensions: n_dims,                 // Number of data fields per data point
            model_timestep: ts,                     // Number of timesteps
            model_timestep_interval: ts_interval    // Output interval for timesteps
        });
    }

    function post_timestep ( index, timestep ) {

        var ranges = [];
        for ( var i=0; i<n_dims; ++i ) {
            ranges.push( [ timestep.min[i], timestep.max[i] ] );
        }

        var message = {
            type: 'timestep',
            data_range: ranges,
            dimensions: n_dims,
            index: index,
            model_time: timestep.model_time,
            model_timestep: timestep.timestep,
            array: timestep.array.buffer
        };

        self.postMessage(
            message,
            [ message.array ]
        );

    }

    function post_start () {
        self.postMessage({
            type: 'start'
        });
    }

    function post_progress ( progress ) {
        self.postMessage({
            type: 'progress',
            progress: progress
        });
    }

    function post_finish () {
        self.postMessage({
            type: 'finish'
        });
    }

    function post_error ( error ) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }

}

function fortnd_worker () {

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

    if ( message.hasOwnProperty( 'data_range' ) && message.hasOwnProperty( 'dimensions' ) &&
         message.hasOwnProperty( 'model_time' ) && message.hasOwnProperty( 'model_timestep' ) &&
         message.hasOwnProperty( 'index' ) && message.hasOwnProperty( 'array' ) ) {

        try {

            _data_range = message.data_range;
            _dimensions = message.dimensions;
            _index = message.index;
            _model_time = message.model_time;
            _model_timestep = message.model_timestep;
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
            file: file
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

                _fortnd.dispatch( { type: 'start' } );

                break;

            case 'progress':

                _fortnd.dispatch( {
                    type: 'progress',
                    progress: message.progress
                } );

                break;

            case 'finish':

                _fortnd.dispatch( { type: 'finish' } );
                _fortnd.dispatch( { type: 'ready' } );

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
        if ( !arguments.length ) return _attributes.keys();
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
        '   gl_FragColor = mix( wire, vec4(face_color, 1.0), edgeFactorTri() );',
        '}'
    ].join('\n');

}

function gradient_shader ( gl, num_colors, min, max ) {

    var _gl = gl;
    var _program = gl_program( _gl, gradient_vertex( num_colors ), gradient_fragment() );
    var _gradient_colors = [];
    var _gradient_stops = [];
    var _wire_color = d3.color( 'black' );
    var _wire_alpha = 0.3;
    var _wire_width = 1.0;

    var min = min || 0;
    var max = max || 1;
    for ( var i=0; i<num_colors; ++i ) {
        _gradient_stops.push( min + ( max-min ) * i/(num_colors-1) );
        _gradient_colors.push( d3.color( d3.schemeCategory20c[i%num_colors] ) );
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
        if ( !arguments.length ) return _attributes.keys();
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
        _gradient_stops = _;
        _gl.useProgram( _program );
        _gl.uniform1fv( _program.uniform( 'gradient_stops' ), _gradient_stops );
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
        .gradient_colors( _program.gradient_colors() )
        .gradient_stops( _program.gradient_stops() )
        .wire_alpha( _program.wire_alpha() )
        .wire_color( _program.wire_color() )
        .wire_width( _program.wire_width() );

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
        '   gl_FragColor = mix( wire, vec4(_vertex_color, 1.0), edgeFactorTri() );',
        '}'
    ].join('\n');

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

function geometry ( gl, indexed ) {

    var _gl = gl;
    var _indexed = indexed || false;

    var _mesh;
    var _buffers = d3.map();

    var _elemental_value;
    var _nodal_value;

    var _bounding_box;
    var _num_triangles;
    var _num_vertices;

    var _subscribers = [];

    function _geometry () {}

    _geometry.bind_buffer = function ( attribute ) {
        var buffer = _buffers.get( attribute );
        _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer.buffer );
        return buffer;
    };

    _geometry.bind_element_array = function () {

        var buffer = _buffers.get( 'element_array' );
        _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, buffer.buffer );
        return _geometry;

    };

    _geometry.bounding_box = function () {
        return _bounding_box;
    };

    _geometry.elemental_value = function ( _ ) {
        _elemental_value = _;
        return _geometry;
    };

    _geometry.indexed = function () {
        return _indexed;
    };

    _geometry.mesh = function ( _ ) {

        if ( !arguments.length ) return _mesh;

        _mesh = _;
        _bounding_box = _mesh.bounding_box();

        var _nodes = _mesh.nodes();
        var _elements = _mesh.elements();

        _num_triangles = _elements.array.length / 3;

        if ( !_indexed ) {

            _num_vertices = 3 * _num_triangles;

            var _coord_array = new Float32Array( 2 * 3 * _num_triangles );      // x, y for all 3 corners
            var _coord_value_array = new Float32Array( 3 * _num_triangles );    // z for all 3 corners

            for ( var i=0; i<3*_num_triangles; ++i ) {      // Loop through element array

                var node_number = _elements.array[ i ];
                var node_index = _nodes.map.get( node_number );

                _coord_array[ 2*i ] = _nodes.array[ 3*node_index ];
                _coord_array[ 2*i + 1 ] = _nodes.array[ 3*node_index + 1 ];
                _coord_value_array[ i ] = _nodes.array[ 3*node_index + 2 ];

            }

        } else {

            _num_vertices = _nodes.array.length / 3;

            var _coord_array = new Float32Array( 2 * _num_vertices / 3 );
            var _coord_value_array = new Float32Array( _num_vertices / 3 );
            var _element_array = new Uint32Array( _num_triangles );
            for ( var i=0; i<_num_triangles; ++i ) {

                var node_number = _elements.array[ i ];
                var node_index = _nodes.map.get( node_number );
                _coord_array[ node_index ] = _nodes.array[ node_index ];
                _coord_array[ node_index + 1 ] = _nodes.array[ node_index + 1 ];
                _coord_value_array[ node_index ] = _nodes.array[ node_index + 2 ];
                _element_array[ i ] = node_index;

            }

            var _element_buffer = _gl.createBuffer();
            _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, _element_buffer );
            _gl.bufferData( _gl.ELEMENT_ARRAY_BUFFER, _element_array, _gl.STATIC_DRAW );

            _buffers.set( 'element_array', {
                buffer: _element_buffer
            });

        }

        var _vertex_buffer = _gl.createBuffer();
        _gl.bindBuffer( _gl.ARRAY_BUFFER, _vertex_buffer );
        _gl.bufferData( _gl.ARRAY_BUFFER, _coord_array, _gl.STATIC_DRAW );

        var _vertex_value_buffer = _gl.createBuffer();
        _gl.bindBuffer( _gl.ARRAY_BUFFER, _vertex_value_buffer );
        _gl.bufferData( _gl.ARRAY_BUFFER, _coord_value_array, _gl.DYNAMIC_DRAW );

        _buffers.set( 'vertex_position', {
            buffer: _vertex_buffer,
            size: 2,
            type: _gl.FLOAT,
            normalized: false,
            stride: 0,
            offset: 0
        });

        _buffers.set( 'vertex_value', {
            buffer: _vertex_value_buffer,
            size: 1,
            type: _gl.FLOAT,
            normalize: false,
            stride: 0,
            offset: 0
        });

        _mesh.subscribe( on_mesh_update );

        return _geometry;
    };

    _geometry.nodal_value = function ( _ ) {
        _nodal_value = _;
        return _geometry;
    };

    _geometry.num_triangles = function () {
        return _num_triangles;
    };

    _geometry.num_vertices = function () {
        return _num_vertices;
    };

    _geometry.request_vertex_attribute = function ( attribute ) {

        switch( attribute ) {

            case 'vertex_normal':
                var normals = build_vertex_normals();
                var buffer = _gl.createBuffer();
                _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer );
                _gl.bufferData( _gl.ARRAY_BUFFER, normals, _gl.STATIC_DRAW );
                _buffers.set( 'vertex_normal', {
                    buffer: buffer,
                    size: 3,
                    type: _gl.FLOAT,
                    normalized: false,
                    stride: 0,
                    offset: 0
                });
                break;

            case 'vertex_position':
            case 'vertex_value':
                break;

            default:
                console.warn( attribute + ' attribute not supported' );

        }

    };

    _geometry.subscribe = function ( _ ) {
        if ( !arguments.length ) {
            _subscribers = [];
            return _geometry;
        }
        _subscribers.push( _ );
        return _geometry;
    };

    return _geometry;

    function on_mesh_update ( value ) {

        if ( value == _nodal_value ) {

            // There will be num_nodes values that need to be applied to 3*num_triangles values
            var data = new Float32Array( 3*_num_triangles );
            var values = _mesh.nodal_value( value );
            var _elements = _mesh.elements();
            var _nodes = _mesh.nodes();

            for ( var i=0; i<3*_num_triangles; ++i ) {

                var node_number = _elements.array[ i ];
                var node_index = _nodes.map.get( node_number );

                data[ i ] = values[ node_index ];

            }

            var buffer = _buffers.get( 'vertex_value' );
            _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer.buffer );
            _gl.bufferSubData( _gl.ARRAY_BUFFER, 0, data );

            _subscribers.forEach( function ( cb ) { cb( value ); } );

        }

        if ( value == _elemental_value ) {

            // There will be num_triangles values that need to be applied to 3*num_triangles values
            var data = new Float32Array( 3*_num_triangles );
            var values = _mesh.elemental_value( value );

            for ( var i=0; i<_num_triangles; ++i ) {

                var value = values[i];

                data[ 3*i ] = value;
                data[ 3*i + 1 ] = value;
                data[ 3*i + 2 ] = value;

            }

            var buffer = _buffers.get( 'vertex_value' );
            _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer.buffer );
            _gl.bufferSubData( _gl.ARRAY_BUFFER, 0, data );

            _subscribers.forEach( function ( cb ) { cb( value ); } );

        }

    }

    function build_vertex_normals () {

        if ( !_indexed ) {

            var _vertex_normals = new Float32Array( 9 * _num_triangles );
            _vertex_normals.fill( 0 );
            for ( var i=0; i<_num_triangles; ++i ) {
                _vertex_normals[ 9 * i ] = 1;
                _vertex_normals[ 9 * i + 4 ] = 1;
                _vertex_normals[ 9 * i + 8 ] = 1;
            }

            return _vertex_normals;

        }

        console.error( 'You shouldn\'t be making vertex normals for indexed arrays' );

    }

}

function view ( gl ) {

    var _gl = gl;
    var _geometry;
    var _shader;

    var _subscribers = [];

    function _view ( geometry, shader ) {

        _geometry = geometry;
        _shader = shader;

        _shader.attributes( function ( attribute, key ) {
            _geometry.request_vertex_attribute( key );
        });

        _geometry.subscribe( on_geometry_update );

        return _view;

    }

    _view.bounding_box = function () {
        if ( _geometry ) return _geometry.bounding_box();
        return [[null,null,null], [null,null,null]];
    };

    _view.geometry = function () {
        return _geometry;
    };

    _view.render = function () {

        if ( _geometry && _shader ) {

            _shader.use();

            _shader.attributes( function ( attribute, key ) {

                var buffer = _geometry.bind_buffer( key );
                _gl.vertexAttribPointer( attribute, buffer.size, buffer.type, buffer.normalized, buffer.stride, buffer.offset );
                _gl.enableVertexAttribArray( attribute );

            });

            if ( _geometry.indexed() ) {

                _geometry.bind_element_array();
                _gl.drawElements(
                    _gl.TRIANGLES,
                    _geometry.num_triangles() * 3,
                    _gl.UNSIGNED_INT,
                    0
                );

            } else {

                _gl.drawArrays( _gl.TRIANGLES, 0, _geometry.num_triangles() * 3 );

            }

        }

        return _view;

    };

    _view.shader = function () {
        return _shader;
    };

    _view.subscribe = function ( _ ) {
        if ( !arguments.length ) {
            _subscribers = [];
            return _view;
        }
        _subscribers.push( _ );
        return _view;
    };

    function on_geometry_update () {

        _subscribers.forEach( function ( cb ) { cb.apply( cb, arguments ); });

    }

    return _view;

}

function gl_renderer () {

    var _gl,
        _extensions;

    var _needs_render = true;

    var _canvas,
        _width = 300,
        _height = 150,
        _pixel_ratio = 1;

    var _selection,
        _zoom = d3.zoom().on( 'zoom', zoomed );

    var _projection_matrix = m4();

    var _clear_color = d3.color( '#666666' );

    var _on_context_lost,
        _on_error;

    var _views = [];

    function _renderer ( canvas ) {

        // Keep local reference to the canvas
        _canvas = canvas;
        _selection = d3.select( _canvas );

        // Verify webgl availability
        if ( !web_gl_available( canvas ) ) {
            if ( _on_error ) _on_error ( 'WebGL not supported' );
            return;
        }

        var _attributes = {
            alpha: false,
            antialias: false,
            premultipliedAlpha: false,
            stencil: true
        };

        // Acquire the webgl context
        _gl = _canvas.getContext( 'webgl', _attributes ) || _canvas.getContext( 'experimental-webgl', _attributes );

        if ( _gl === null ) {
            if ( _on_error ) _on_error ( 'Error creating WebGL context' );
            return;
        }

        // Connect any existing event listeners
        if ( _on_context_lost ) _canvas.addEventListener( 'webglcontextlost', _on_context_lost, false );

        // Load extensions
        _extensions = gl_extensions( _gl );
        _extensions.get( 'ANGLE_instanced_arrays' );
        _extensions.get( 'OES_element_index_uint' );
        _extensions.get( 'OES_standard_derivatives' );

        // Set up the renderer
        _renderer.clear_color( _renderer.clear_color() );
        check_render();

        // Set up interactivity
        _selection.call( _zoom );

        return _renderer;

    }

    _renderer.add_mesh = function ( m ) {

        var geo = geometry( _gl ).mesh( m );
        // var shader = basic_shader( _gl );
        // var shader = gradient_shader( _gl, 3 ).wire_alpha( 0.3 ).wire_width( 1.0 );
        var shader = gradient_shader( _gl, 10, geo.bounding_box()[0][2], geo.bounding_box()[1][2] );
        //     .set_gradient( [ 0, 0.5, 1 ], [ d3.color('steelblue'), d3.color('white'), d3.color('green') ] )
        //     .wire_color( d3.color( 'black' ) )
        //     .set_wire_alpha( 0.25 )
        //     .set_wire_width( 2.5 );
        var vew = view( _gl );

        _views.push( vew( geo, shader ) );

        update_projection();

        return _renderer.render();

    };

    _renderer.add_view = function ( view$$1 ) {

        view$$1.subscribe( _renderer.render );
        _views.push( view$$1 );
        update_projection();
        return _renderer.render();

    };

    _renderer.clear_color = function (_) {
        if ( !arguments.length ) return _clear_color;
        if ( arguments.length == 1 ) _clear_color = _;
        if ( arguments.length == 3 ) _clear_color = d3.rgb( arguments[0], arguments[1], arguments[2] );
        if ( arguments.length == 4 ) _clear_color = d3.rgb( arguments[0], arguments[1], arguments[2], arguments[3] );
        if ( _gl && _clear_color ) {
            _gl.clearColor(
                _clear_color.r / 255,
                _clear_color.g / 255,
                _clear_color.b / 255,
                _clear_color.opacity
            );
            _renderer.render();
        }
        return _renderer;
    };

    _renderer.gl_context = function (_) {
        if ( !arguments.length ) return _gl;
        _gl = _;
        return _renderer;
    };

    _renderer.on_context_lost = function (_) {
        if ( !arguments.length ) return _on_context_lost;
        if ( typeof _ === 'function' ) _on_context_lost = _;
        return _renderer;
    };

    _renderer.on_error = function (_) {
        if ( !arguments.length ) return _on_error;
        if ( typeof _ === 'function' ) _on_error = _;
        return _renderer;
    };

    _renderer.render = function () {

        _needs_render = true;
        return _renderer;

    };

    _renderer.zoom_to = function (_) {

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

    };


    return _renderer;

    function check_render () {

        if ( resize() || _needs_render ) {

            _needs_render = false;
            render();

        }

        requestAnimationFrame( check_render );

    }

    function render () {

        _gl.clear( _gl.COLOR_BUFFER_BIT | _gl.DEPTH_BUFFER_BIT );

        for ( var i=0; i<_views.length; ++i ) {
            _views[i].render();
        }

    }

    function resize () {

        if ( _canvas.clientWidth != _width || _canvas.clientHeight != _height ) {

            _width = _canvas.clientWidth;
            _height = _canvas.clientHeight;
            _canvas.width = _width * _pixel_ratio;
            _canvas.height = _height * _pixel_ratio;
            _gl.viewport( 0, 0, _width, _height );
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
            .ortho( 0, _width,  _height, 0, -10000, 10000 )
            .translate( tx, ty, 0 )
            .scale( k, -k, 1 )
            .translate( 0, -_height, 0 );

        for ( var i=0; i<_views.length; ++i ) {
            _views[i].shader().set_projection( _projection_matrix );
        }

    }

    function zoomed () {
        var t = d3.event.transform;
        update_projection( t.k, t.x, t.y );
        _renderer.render();
    }
    
}

function web_gl_available ( canvas ) {

    return !! ( window.WebGLRenderingContext && ( canvas.getContext( 'webgl' ) || canvas.getContext( 'experimental-webgl' ) ) );

}

function mesh () {

    var _nodes = { array: [], map: d3.map() };
    var _elements = { array: [], map: d3.map() };

    var _nodal_values = d3.map();
    var _elemental_values = d3.map();

    var _subscribers = [];

    var _bounding_box;

    function _mesh () {}

    _mesh.bounding_box = function () {
        return _bounding_box;
    };

    _mesh.elemental_value = function ( value, array ) {
        if ( arguments.length == 1 ) return _elemental_values.get( value );
        if ( arguments.length == 2 ) _elemental_values.set( value, array );
        _subscribers.forEach( function ( cb ) { cb( value ); } );
    };

    _mesh.elements = function (_) {
        if ( !arguments.length ) return _elements;
        if ( _.array && _.map ) {
            _elements = _;
        }
        return _mesh;
    };

    _mesh.element_array = function ( _ ) {
        if ( !arguments.length ) return _elements.array;
        _elements.array = _;
        return _mesh;
    };

    _mesh.element_index = function ( element_number ) {
        return _elements.map.get( element_number );
    };

    _mesh.element_map = function ( _ ) {
        if ( !arguments.length ) return _elements.map;
        _elements.map = _;
        return _mesh;
    };

    _mesh.nodal_value = function ( value, array ) {
        if ( arguments.length == 1 ) return _nodal_values.get( value );
        if ( arguments.length == 2 ) _nodal_values.set( value, array );
        _subscribers.forEach( function ( cb ) { cb( value ); } );
        return _mesh;
    };

    _mesh.nodes = function (_) {
        if ( !arguments.length ) return _nodes;
        if ( _.array && _.map ) {
            _nodes = _;
            _bounding_box = calculate_bbox( _nodes.array );
        }
        return _mesh;
    };

    _mesh.node_array = function ( _ ) {
        if ( !arguments.length ) return _nodes.array;
        _nodes.array = _;
        calculate_bbox( _mesh.node_array() );
        return _mesh;
    };

    _mesh.node_index = function ( node_number ) {
        return _nodes.map.get( node_number );
    };

    _mesh.node_map = function ( _ ) {
        if ( !arguments.length ) return _nodes.map;
        _nodes.map = _;
        return _mesh;
    };

    _mesh.num_elements = function () {
        return _elements.array.length / 3;
    };

    _mesh.num_nodes = function () {
        return _nodes.array.length / 3;
    };

    _mesh.subscribe = function ( callback ) {
        _subscribers.push( callback );
    };

    return _mesh;

}

function calculate_bbox ( node_array ) {

    var numnodes = node_array.length/3;
    var minx = Infinity, maxx = -Infinity;
    var miny = Infinity, maxy = -Infinity;
    var minz = Infinity, maxz = -Infinity;
    for ( var i=0; i<numnodes; ++i ) {
        if ( node_array[3*i] < minx ) minx = node_array[3*i];
        else if ( node_array[3*i] > maxx ) maxx = node_array[3*i];
        if ( node_array[3*i+1] < miny ) miny = node_array[3*i+1];
        else if ( node_array[3*i+1] > maxy ) maxy = node_array[3*i+1];
        if ( node_array[3*i+2] < minz ) minz = node_array[3*i+2];
        else if ( node_array[3*i+2] > maxz ) maxz = node_array[3*i+2];
    }
    return [[minx, miny, minz], [maxx, maxy, maxz]];

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

            _data[ _index( dataset_index ) ] = _transform( _index( dataset_index), dataset );
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

        if ( _cache.is_full() ) _cache.dispatch( { type: 'ready' } );

    }

}

exports.fort14 = fort14;
exports.fort63 = fort63;
exports.fort64 = fort64;
exports.gl_renderer = gl_renderer;
exports.mesh = mesh;
exports.geometry = geometry;
exports.view = view;
exports.basic_shader = basic_shader;
exports.gradient_shader = gradient_shader;
exports.cache = cache;
exports.dispatcher = dispatcher;

Object.defineProperty(exports, '__esModule', { value: true });

})));

var canvas = document.getElementById( 'canvas' );
var renderer = adcirc.gl_renderer()( canvas );

var sample_button = document.getElementById( 'sample_button' );
var animate_button = document.getElementById( 'animate' );
var f14_picker = document.getElementById( 'f14' );
var f63_picker = document.getElementById( 'f63' );
var f64_picker = document.getElementById( 'f64' );

var f63;

var progress_bar = document.getElementById( 'progress' );
var progress_text = document.getElementById( 'percent' );

var shader = adcirc
    .gradient_shader( renderer.gl_context(), 4 )
    .gradient_stops( [0.8, 0.3, -0.3, -0.8] )
    .gradient_colors([
        d3.color( 'dodgerblue' ),
        d3.color( 'lightskyblue' ),
        d3.color( 'lightgreen' ),
        d3.color( 'forestgreen' )
    ]);

var view = adcirc.view( renderer.gl_context() );
var geometry = adcirc.geometry( renderer.gl_context() )
    .nodal_value( 'depth' );

var mesh;

sample_button.onclick = load_sample_file;
animate_button.onclick = animate;
f14_picker.onchange = function () { test_fort_14() };
f63_picker.onchange = test_fort_63;
f64_picker.onchange = test_fort_64;

function on_slider ( location ) {

    f63.load_timestep( Math.floor( 100 * location ), function ( data ) {
        mesh.nodal_value( 'depth', data.array );
    });

}

function load_sample_file () {

    var xhr = new XMLHttpRequest();
    xhr.open( 'GET', 'fort.14', true );
    xhr.responseType = 'blob';
    xhr.onprogress = function ( e ) {
        progress( 100 * e.loaded/e.size );
    };
    xhr.onload = function () {
        if ( this.status == 200 ) {
            test_fort_14( this.response );
        } else {
            console.log( 'Error loading fort.14' );
        }
    };
    xhr.send();

}

function animate () {
    d3.interval( function () {
        var d = new Float32Array( mesh.num_elements() );
        for ( var i=0; i<mesh.num_elements(); ++i ) {
            d[i] = -2 + 12 * Math.random();
        }
        mesh.nodal_value( 'depth', d );
    }, 200 );
}

function test_fort_14 ( f ) {

    f = f || f14_picker.files[0];
    mesh = adcirc.mesh();

    var f14 = adcirc.fort14()
        .on_start( start, true )
        .on_progress( progress, true )
        .on_finish( finish, true )
        .nodes( function ( nodes ) {
            mesh.nodes( nodes );
            on_loaded();
        })
        .elements( function ( elements ) {
            mesh.elements( elements );
            on_loaded();
        })
        .read( f );

    function on_loaded () {
        if ( mesh.num_nodes() && mesh.num_elements() ) {

            geometry.mesh( mesh );
            renderer.add_view( view( geometry, shader ) )
                .zoom_to( mesh, 500 );



        }
    }

}

function test_fort_63 () {

    f63 = adcirc.fort63()
        .on_start( start, true )
        .on_progress( progress, true )
        .on_finish( finish, true )
        .on_finish( function () {
            f63.load_timestep( 0, function ( data ) {
                mesh.nodal_value( 'depth', data.array );
            });
        })
        .read( f63_picker.files[0] );

}

function test_fort_64 () {

}

function start () {
    progress_bar.style.width = 0;
    progress_text.innerHTML = '0%';
}

function progress ( p ) {
    progress_bar.style.width = p.toFixed(1) + '%';
    progress_text.innerHTML = p.toFixed(1) + '%';
}

function finish () {
    progress_bar.style.width = '100%';
    progress_text.innerHTML = '100%';
}

function setup_slider () {

    var slider = d3.select( '#slider' );
    var slider_bar = d3.select( '#slider-bar' );

    slider_bar.call(
        d3.drag().on( 'start drag', set_slider_location )
    );

    var below_called = false;
    var above_called = true;

    function set_slider_location () {
        var loc = d3.mouse(this)[0];
        var width = parseFloat( slider_bar.style( 'width' ) );
        if ( loc < 0 ) {
            if ( !below_called ) on_slider( 0 );
            below_called = true;
            above_called = false;
            slider.style( 'width', 0 );
        }
        else if ( loc > width ) {
            if ( !above_called ) on_slider( 1 );
            below_called = false;
            above_called = true;
            slider.style( 'width', width + 'px' );
        }
        else {
            below_called = false;
            above_called = false;
            slider.style( 'width', loc + 'px' );
            on_slider( loc / width );
        }
    }

}


setup_slider();